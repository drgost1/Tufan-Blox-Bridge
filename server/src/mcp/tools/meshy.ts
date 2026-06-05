import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, type ToolText } from "../helpers.js";
import { scrub } from "../../openCloud.js";
import {
  MESHY_KEY_HELP,
  meshyKey,
  autoConfirm,
  startTextPreview,
  startImageTo3D,
  startRemesh,
  pollTask,
  downloadTask,
  driveGeneration,
  describeTask,
  type MeshyTask,
  type DownloadedAsset,
} from "../../meshy/client.js";

// Meshy AI generation tools. Long generations never block past the wait budget:
// the call returns the taskId as a resume token (the operationId pattern from
// import_file) and re-calling with { taskId } picks up where it left off —
// statelessly, since Meshy tasks are re-queryable by id.

const IMG_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function waitBudgetMs(waitSeconds?: number): number {
  return Math.min(Math.max(waitSeconds ?? 120, 10), 600) * 1000;
}

function downloadedText(d: DownloadedAsset, prefix?: string): ToolText {
  const lines = [
    ...(prefix ? [prefix] : []),
    `✅ ${describeTask(d.task)}`,
    `GLB: ${d.glbPath}`,
    ...Object.entries(d.textures).map(([k, v]) => `texture ${k}: ${v}`),
    `Next: blender_process({ inputFile: "${d.glbPath}", action: "inspect" }) to lint against Roblox limits, ` +
      `then import_file({ filePath: "${d.glbPath}" }) to upload+insert — or use generate_asset to do all of it in one call.`,
  ];
  return text(lines.join("\n"));
}

function resumeText(tool: string, task: MeshyTask, stage: string): ToolText {
  return text(
    `${describeTask(task)} — still processing (${stage}).\n` +
      `Resume with: ${tool}({ taskId: "${task.id}" }) — no extra credits, the task keeps running on Meshy's side.`,
  );
}

/** Drive a generation to completion and format the outcome for this tool. */
async function continueGeneration(
  key: string,
  taskId: string,
  deadline: number,
  enablePbr: boolean,
): Promise<ToolText> {
  const outcome = await driveGeneration(key, taskId, deadline, enablePbr);
  switch (outcome.kind) {
    case "pending":
      return resumeText("meshy_generate", outcome.task, outcome.stage);
    case "failed":
      return errorText(`Meshy generation failed: ${describeTask(outcome.task)}`);
    case "downloaded":
      return downloadedText(outcome.asset);
  }
}

export function registerMeshyTools(server: McpServer) {
  server.registerTool(
    "meshy_generate",
    {
      description:
        "Generate a 3D model with Meshy AI from a text prompt (two-stage: geometry preview → texture " +
        "refine, auto-chained) or a single image (imageUrl or local imagePath). Downloads the resulting " +
        "GLB + PBR maps to the local work dir (~/.tufan-blox-bridge/assets/<taskId>/) and reports the " +
        "paths — pair with blender_process (lint/fix) and import_file (upload+insert), or use " +
        "generate_asset for the whole pipeline in one call. SPENDS MESHY CREDITS (~30 ≈ $0.60 per " +
        "textured asset): the first call returns a cost estimate and asks for confirm:true unless " +
        "TUFAN_MESHY_AUTOCONFIRM=1. Generation takes minutes; if waitSeconds runs out you get a taskId " +
        "to resume with (no re-spend). Needs TUFAN_MESHY_KEY (paid Meshy plan).",
      inputSchema: {
        prompt: z.string().optional().describe("Text description of the model (mutually exclusive with image*)"),
        imageUrl: z.string().optional().describe("Public image URL for image-to-3D"),
        imagePath: z.string().optional().describe("Local image file (.png/.jpg/.webp) for image-to-3D"),
        targetPolycount: z
          .number()
          .optional()
          .describe("Target triangle count (Meshy default is 30k — ABOVE Roblox's 20k limit; 18000 recommended)"),
        enablePbr: z.boolean().optional().describe("Generate PBR maps (default true)"),
        topology: z.enum(["quad", "triangle"]).optional().describe("Mesh topology (default triangle)"),
        waitSeconds: z.number().optional().describe("Max seconds to wait before returning a resume taskId (default 120, max 600)"),
        taskId: z.string().optional().describe("Resume a previous generation instead of starting a new one"),
        confirm: z.boolean().optional().describe("Confirm the credit spend for a NEW generation"),
      },
    },
    async ({ prompt, imageUrl, imagePath, targetPolycount, enablePbr, topology, waitSeconds, taskId, confirm }) => {
      const key = meshyKey();
      if (!key) return errorText(MESHY_KEY_HELP);
      const deadline = Date.now() + waitBudgetMs(waitSeconds);
      const pbr = enablePbr !== false;

      try {
        // Resume path — no credit gate (continuing an already-paid task; the
        // refine auto-chain was covered by the original estimate).
        if (taskId) return await continueGeneration(key, taskId, deadline, pbr);

        const sources = [prompt, imageUrl, imagePath].filter(Boolean).length;
        if (sources !== 1) {
          return errorText("Provide exactly ONE of: prompt (text-to-3D), imageUrl or imagePath (image-to-3D).");
        }
        if (!confirm && !autoConfirm()) {
          return text(
            `This will spend ~30 Meshy credits (~$0.60 on the Pro plan) for a textured ${prompt ? "text" : "image"}-to-3D generation` +
              `${targetPolycount ? " (+5 if a remesh pass is needed)" : ""}.\n` +
              `Re-run with confirm: true to proceed (or set TUFAN_MESHY_AUTOCONFIRM=1 to skip this gate).`,
          );
        }

        let firstTaskId: string;
        if (prompt) {
          firstTaskId = await startTextPreview(key, prompt, { targetPolycount, topology });
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
          firstTaskId = await startImageTo3D(key, url, { enablePbr: pbr, targetPolycount, topology });
        }
        return await continueGeneration(key, firstTaskId, deadline, pbr);
      } catch (e) {
        return errorText(`meshy_generate failed: ${scrub((e as Error).message, key)}`);
      }
    },
  );

  server.registerTool(
    "meshy_task",
    {
      description:
        "Inspect or act on an existing Meshy task by id: status (poll progress), download (re-fetch " +
        "fresh signed URLs and save the GLB + PBR maps locally), remesh (retopologize an existing task's " +
        "model to targetPolycount — 5 credits; use to bring a >20k-tri result under Roblox's limit " +
        "without regenerating). Needs TUFAN_MESHY_KEY.",
      inputSchema: {
        taskId: z.string().describe("The Meshy task id"),
        action: z.enum(["status", "download", "remesh"]).optional().describe("Default: status"),
        targetPolycount: z.number().optional().describe("For remesh (default 18000 — safe under Roblox's 20k)"),
        waitSeconds: z.number().optional().describe("Poll budget for status/remesh (default 120, max 600)"),
      },
    },
    async ({ taskId, action, targetPolycount, waitSeconds }) => {
      const key = meshyKey();
      if (!key) return errorText(MESHY_KEY_HELP);
      try {
        switch (action ?? "status") {
          case "status": {
            const { done, task } = await pollTask(key, taskId, waitBudgetMs(waitSeconds));
            if (!done) return resumeText("meshy_task", task, "processing");
            if (task.status !== "SUCCEEDED") return errorText(describeTask(task));
            return text(`${describeTask(task)}\nDownload with: meshy_task({ taskId: "${task.id}", action: "download" })`);
          }
          case "download":
            return downloadedText(await downloadTask(key, taskId));
          case "remesh": {
            const remeshId = await startRemesh(key, taskId, targetPolycount ?? 18_000);
            const { done, task } = await pollTask(key, remeshId, waitBudgetMs(waitSeconds));
            if (!done) return resumeText("meshy_task", task, "remeshing");
            if (task.status !== "SUCCEEDED") return errorText(`Remesh failed: ${describeTask(task)}`);
            return downloadedText(await downloadTask(key, task.id), `Remeshed ${taskId} → ${task.id} (5 credits)`);
          }
        }
      } catch (e) {
        return errorText(`meshy_task failed: ${scrub((e as Error).message, key)}`);
      }
    },
  );
}
