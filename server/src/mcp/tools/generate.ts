import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg, type ToolText } from "../helpers.js";
import {
  OC_KEY_HELP,
  scrub,
  pollOperation,
  finishOperation,
  uploadFile,
} from "../../openCloud.js";
import {
  MESHY_KEY_HELP,
  meshyKey,
  autoConfirm,
  startTextPreview,
  startImageTo3D,
  driveGeneration,
  describeTask,
  pollTask,
  downloadTask,
} from "../../meshy/client.js";
import { resolveBlender } from "../../blender/detect.js";
import { runBlender } from "../../blender/runner.js";
import { buildOpScript } from "../../blender/scripts.js";

// The flagship pipeline: text prompt (or image) → Meshy AI generation → headless
// Blender Roblox-readiness lint (+ auto-fix: decimate >20k tris, downscale >1024
// textures) → Open Cloud upload → insert into the open place. Each stage reuses
// the existing subsystem (meshy/client, blender/*, openCloud) — this file only
// orchestrates and reports.

const IMG_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

type Lint = {
  objects?: Array<{
    name: string;
    tris: number;
    multi_material?: boolean;
    over_tri_limit?: boolean;
    base_color?: [number, number, number] | null;
    has_texture?: boolean;
  }>;
  warnings?: string[];
  oversize_textures?: Array<{ name: string; size: number[] }>;
  totals?: { objects: number; tris: number };
  roblox_ready?: boolean;
};

/** Run a canned Blender op; returns the parsed result or an error string. */
async function blenderOp(
  blenderPath: string,
  action: string,
  args: Record<string, string | number>,
): Promise<{ result?: any; error?: string }> {
  const r = await runBlender({ blenderPath, script: buildOpScript(action), args, timeoutMs: 240_000 });
  if (!r.ok) return { error: r.pythonError ?? r.error ?? "Blender failed" };
  return { result: r.result };
}

export function registerGenerateTools(server: McpServer) {
  server.registerTool(
    "generate_asset",
    {
      description:
        "FULL PIPELINE: turn a text prompt (or an image) into a game-ready asset in the open place — " +
        "Meshy AI generates the textured mesh, headless Blender lints it against Roblox limits and " +
        "auto-fixes (decimates >20k tris, downscales >1024px textures; autoFix:false to skip), then the " +
        "GLB uploads to the user's Roblox account via Open Cloud and inserts as a Model. SPENDS MESHY " +
        "CREDITS (~30 ≈ $0.60 per asset) — first call returns a cost estimate and asks for confirm:true " +
        "unless TUFAN_MESHY_AUTOCONFIRM=1. Generation takes minutes; on budget exhaustion you get a " +
        "meshyTaskId to resume with (no re-spend). Position the inserted model afterwards with place_on. " +
        "Needs TUFAN_MESHY_KEY + TUFAN_OPENCLOUD_KEY (Blender optional but recommended). For an EXISTING " +
        "marketplace asset by id use insert_asset instead; for a local file you already have use import_file " +
        "instead; to generate WITHOUT auto-inserting into the place (just the raw model), use meshy_generate instead.",
      inputSchema: {
        prompt: z.string().optional().describe("Text description of the asset (mutually exclusive with image*)"),
        imageUrl: z.string().optional().describe("Public image URL for image-to-3D"),
        imagePath: z.string().optional().describe("Local image file (.png/.jpg/.webp) for image-to-3D"),
        name: z.string().optional().describe("Display name on Roblox (default: derived from the prompt)"),
        targetPolycount: z
          .number()
          .optional()
          .describe("Triangle budget requested from Meshy AND used by the decimate auto-fix (default 18000)"),
        enablePbr: z.boolean().optional().describe("Generate PBR maps (default true)"),
        autoFix: z
          .boolean()
          .optional()
          .describe("Auto-decimate/downscale when the lint flags Roblox-limit violations (default true)"),
        parentPath: z.string().optional().describe("Where to insert in the place (default Workspace)"),
        insert: z.boolean().optional().describe("Insert into the place after upload (default true)"),
        anchor: z.boolean().optional().describe("Anchor all parts after insert so the prop can't fall (default true)"),
        targetHeightStuds: z
          .number()
          .optional()
          .describe("Scale the inserted model so its height equals this many studs (a character is ~5)"),
        collisionFidelity: z
          .enum(["Default", "Hull", "Box", "PreciseConvexDecomposition"])
          .optional()
          .describe("Set on every MeshPart after insert — Hull is a good cheap choice for static props"),
        onGround: z.boolean().optional().describe("After insert+scale, drop the model flush onto whatever is below it"),
        position: z
          .array(z.number())
          .length(3)
          .optional()
          .describe("[x,y,z] world position for the inserted model's pivot (instead of onGround)"),
        waitSeconds: z.number().optional().describe("Max seconds for the generation stage (default 240, max 600)"),
        meshyTaskId: z.string().optional().describe("Resume from an existing Meshy task (skips generation + credits)"),
        confirm: z.boolean().optional().describe("Confirm the credit spend for a NEW generation"),
        previewFirst: z
          .boolean()
          .optional()
          .describe(
            "Text-to-3D only: stop after the geometry preview (20cr) and return a rendered thumbnail to " +
              "approve BEFORE spending the texture refine (+10cr) and uploading. Approve by re-calling " +
              "with { meshyTaskId } (without previewFirst).",
          ),
        place: placeArg,
      },
    },
    async ({
      prompt,
      imageUrl,
      imagePath,
      name,
      targetPolycount,
      enablePbr,
      autoFix,
      parentPath,
      insert,
      anchor,
      targetHeightStuds,
      collisionFidelity,
      onGround,
      position,
      waitSeconds,
      meshyTaskId,
      confirm,
      previewFirst,
      place,
    }) => {
      const mKey = meshyKey();
      if (!mKey) return errorText(MESHY_KEY_HELP);
      const ocKey = process.env.TUFAN_OPENCLOUD_KEY?.trim();
      if (!ocKey) return errorText(`generate_asset uploads through Open Cloud — ${OC_KEY_HELP}`);

      const deadline = Date.now() + Math.min(Math.max(waitSeconds ?? 240, 30), 600) * 1000;
      const pbr = enablePbr !== false;
      const triBudget = Math.round(targetPolycount ?? 18_000);
      const report: string[] = [];

      try {
        // ---- Stage 0 (opt-in): preview-and-approve — stop at the geometry
        // preview, render a thumbnail, let the user approve before the refine
        // spend + upload. Approval = re-call with meshyTaskId (no previewFirst);
        // driveGeneration then auto-chains the refine from the SUCCEEDED preview.
        if (previewFirst && (prompt || meshyTaskId) && !imageUrl && !imagePath) {
          let pTaskId = meshyTaskId;
          if (!pTaskId) {
            if (!confirm && !autoConfirm()) {
              return text(
                `previewFirst: this will spend ~20 Meshy credits (~$0.40) for an UNTEXTURED geometry preview ` +
                  `of "${prompt}". You approve the +10cr texture refine separately after seeing the thumbnail.\n` +
                  `Re-run with confirm: true to proceed.`,
              );
            }
            pTaskId = await startTextPreview(mKey, prompt!, { targetPolycount: triBudget, topology: "triangle" });
          }
          const { done, task } = await pollTask(mKey, pTaskId, Math.max(deadline - Date.now(), 10_000));
          if (!done) {
            return text(
              `${describeTask(task)} — preview still generating.\n` +
                `Resume with: generate_asset({ meshyTaskId: "${task.id}", previewFirst: true }) — no extra credits.`,
            );
          }
          if (task.status !== "SUCCEEDED") return errorText(`Meshy preview failed: ${describeTask(task)}`);
          if (task.mode === "preview") {
            const asset = await downloadTask(mKey, task.id);
            const approveLine =
              `Approve → generate_asset({ meshyTaskId: "${task.id}"${name ? `, name: "${name}"` : ""}` +
              `${parentPath ? `, parentPath: "${parentPath}"` : ""} }) to texture (+10cr), upload and insert. ` +
              `Or discard — the preview GLB stays at ${asset.glbPath}.`;
            const blender = await resolveBlender();
            if ("error" in blender) {
              return text(`Preview ready (untextured): ${describeTask(task)}\nGLB: ${asset.glbPath}\n(no Blender found for a thumbnail render)\n${approveLine}`);
            }
            const thumb = await blenderOp(blender.path, "thumbnail", {
              in: asset.glbPath!,
              out: join(asset.dir, `${task.id}.thumb.png`),
            });
            if (thumb.error || !thumb.result?.thumbnail) {
              return text(`Preview ready (untextured): ${describeTask(task)}\nGLB: ${asset.glbPath}\n(thumbnail render failed: ${(thumb.error ?? "no output").split("\n")[0]})\n${approveLine}`);
            }
            const png = await readFile(String(thumb.result.thumbnail));
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Preview ready (untextured geometry, ${describeTask(task)}):\n${approveLine}`,
                },
                { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
              ],
            };
          }
          // taskId already past the preview stage — fall through to the normal flow.
        }

        // ---- Stage 1: Meshy generation (or resume) -------------------------
        let genTaskId = meshyTaskId;
        if (!genTaskId) {
          const sources = [prompt, imageUrl, imagePath].filter(Boolean).length;
          if (sources !== 1) {
            return errorText("Provide exactly ONE of: prompt (text-to-3D), imageUrl or imagePath (image-to-3D).");
          }
          if (!confirm && !autoConfirm()) {
            return text(
              `This will spend ~30 Meshy credits (~$0.60 on the Pro plan) to generate "${name ?? prompt ?? "image asset"}", ` +
                `then upload the result to your Roblox account.\n` +
                `Re-run with confirm: true to proceed (or set TUFAN_MESHY_AUTOCONFIRM=1 to skip this gate).`,
            );
          }
          if (prompt) {
            genTaskId = await startTextPreview(mKey, prompt, { targetPolycount: triBudget, topology: "triangle" });
          } else {
            let url = imageUrl!;
            if (imagePath) {
              const mime = IMG_MIME[extname(imagePath).toLowerCase()];
              if (!mime) return errorText(`Unsupported image extension "${extname(imagePath)}" — use .png/.jpg/.webp`);
              let buf: Buffer;
              try {
                buf = await readFile(imagePath);
              } catch {
                return errorText(`Image file not found: ${imagePath}`);
              }
              url = `data:${mime};base64,${buf.toString("base64")}`;
            }
            genTaskId = await startImageTo3D(mKey, url, { enablePbr: pbr, targetPolycount: triBudget, topology: "triangle" });
          }
        }

        const outcome = await driveGeneration(mKey, genTaskId, deadline, pbr);
        if (outcome.kind === "pending") {
          return text(
            `${describeTask(outcome.task)} — still processing (${outcome.stage}).\n` +
              `Resume with: generate_asset({ meshyTaskId: "${outcome.task.id}"${name ? `, name: "${name}"` : ""}${parentPath ? `, parentPath: "${parentPath}"` : ""} }) — no extra credits.`,
          );
        }
        if (outcome.kind === "failed") {
          return errorText(`Meshy generation failed: ${describeTask(outcome.task)}`);
        }
        const asset = outcome.asset;
        let glb = asset.glbPath!;
        report.push(`🧊 generated: ${describeTask(asset.task)}`, `GLB: ${glb}`);

        // ---- Stage 2: Blender lint + auto-fix (graceful without Blender) ---
        let finalLint: Lint | undefined;
        const blender = await resolveBlender();
        if ("error" in blender) {
          report.push(
            "⚠ lint skipped — Blender not found (Roblox SILENTLY decimates meshes over 20k tris and " +
              "downscales textures over 1024px; install Blender or set TUFAN_BLENDER_PATH for a controlled pass)",
          );
        } else {
          const lintRun = await blenderOp(blender.path, "inspect", { in: glb });
          if (lintRun.error) {
            report.push(`⚠ lint failed (continuing to upload): ${lintRun.error.split("\n")[0]}`);
          } else {
            let lint = lintRun.result as Lint;
            report.push(
              `lint: ${lint.totals?.objects ?? "?"} object(s), ${lint.totals?.tris ?? "?"} tris` +
                (lint.roblox_ready ? " — roblox_ready ✅" : ` — ${lint.warnings?.length ?? 0} warning(s)`),
            );

            const fix = autoFix !== false;
            if (fix && lint.objects?.some((o) => o.over_tri_limit)) {
              const out = join(asset.dir, `${asset.task.id}.decimate.glb`);
              const d = await blenderOp(blender.path, "decimate", {
                in: glb,
                out,
                target: Math.min(triBudget, 20_000),
              });
              if (d.error) {
                report.push(`⚠ auto-decimate failed (uploading original): ${d.error.split("\n")[0]}`);
              } else {
                glb = out;
                lint = d.result as Lint;
                const dec = (d.result?.decimated ?? []) as Array<{ name: string; before: number; after: number }>;
                report.push(
                  `🔧 auto-decimated: ${dec.map((x) => `${x.name} ${x.before}→${x.after}`).join(", ")} (now ${lint.totals?.tris} tris)`,
                );
              }
            }
            if (fix && (lint.oversize_textures?.length ?? 0) > 0) {
              const out = join(asset.dir, `${asset.task.id}.downscale.glb`);
              const t = await blenderOp(blender.path, "downscale_textures", { in: glb, out, tex_limit: 1024 });
              if (t.error) {
                report.push(`⚠ texture downscale failed (uploading as-is): ${t.error.split("\n")[0]}`);
              } else {
                glb = out;
                const scaled = (t.result?.scaled ?? []) as Array<{ name: string; from: number[]; to: number[] }>;
                report.push(`🔧 textures downscaled to ≤1024: ${scaled.map((s) => s.name).join(", ")}`);
              }
            }
            for (const o of lint.objects ?? []) {
              if (o.multi_material) {
                report.push(
                  `⚠ ${o.name} has multiple materials — Roblox imports ONE material per mesh object; ` +
                    `run blender_process({ action: "split_by_material" }) first if you need them separate`,
                );
              }
            }
            finalLint = lint;
          }
        }

        // ---- Stage 3: Open Cloud upload + insert ---------------------------
        const displayName = name ?? (prompt ? prompt.slice(0, 50) : `meshy ${asset.task.id.slice(0, 8)}`);
        const up = await uploadFile({
          filePath: glb,
          displayName,
          description: prompt ? `AI-generated via Tufan-Blox-Bridge: ${prompt.slice(0, 120)}` : undefined,
          key: ocKey,
          place,
        });
        if (!up.ok) {
          report.push("", "Upload stage failed:");
          return errorText(`${report.join("\n")}\n${up.error.content[0]?.text ?? "unknown upload error"}`);
        }
        const remainingMs = Math.max(deadline - Date.now(), 30_000);
        const op = await pollOperation(up.operationId, ocKey, remainingMs);
        if (!op) {
          report.push(
            "",
            `Upload accepted — Roblox is still processing.`,
            `Resume the upload stage with: import_file({ operationId: "${up.operationId}" })`,
          );
          return text(report.join("\n"));
        }

        // ---- Stage 4: post-insert finishing (anchor/rename/recolor/scale/place) ----
        // Flat-color recovery list from the lint: objects whose material is NOT
        // texture-driven lose their baseColorFactor on import (known Roblox bug).
        const recolor = (finalLint?.objects ?? [])
          .filter((o) => o.has_texture === false && Array.isArray(o.base_color))
          .map((o) => ({ object: o.name, color: o.base_color as [number, number, number] }));
        const finishing = {
          anchor: anchor !== false,
          targetHeightStuds,
          collisionFidelity,
          onGround,
          position: position as [number, number, number] | undefined,
          recolor,
          attributes: {
            ...(prompt ? { TufanPrompt: prompt.slice(0, 200) } : {}),
            TufanMeshyTask: asset.task.id,
            ...(op?.response?.assetId ? { TufanAssetId: String(op.response.assetId) } : {}),
            TufanGeneratedAt: new Date().toISOString().slice(0, 10),
          },
        };
        const final = await finishOperation(op, up.kind, up.displayName, insert !== false, parentPath, place, finishing);
        const finalText = final.content[0]?.text ?? "";
        report.push("", finalText);
        if (!final.isError && insert !== false) {
          report.push(`Position it with: place_on (raycast-flush placement) or move_instance.`);
        }
        // AI-generated content gets the same moderation as any upload — make a
        // non-approved state loud since false-flags on AI assets are a known risk.
        return final.isError ? errorText(report.join("\n")) : text(report.join("\n"));
      } catch (e) {
        return errorText(`generate_asset failed: ${scrub(scrub((e as Error).message, mKey), ocKey)}`);
      }
    },
  );
}
