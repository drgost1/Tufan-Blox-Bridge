import { z } from "zod";
import { stat } from "node:fs/promises";
import { dirname, basename, extname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText } from "../helpers.js";
import { resolveBlender, BLENDER_HELP } from "../../blender/detect.js";
import { runBlender, type BlenderRun } from "../../blender/runner.js";
import { buildOpScript, buildUserScript, CANNED_OPS } from "../../blender/scripts.js";

// Headless Blender processing for the asset pipeline. Runs the user's installed
// Blender (auto-detected, or TUFAN_BLENDER_PATH) in background mode — no Studio
// involvement, local files in → local files out. blender_process never mutates
// its input file; mutating actions write a NEW output file.

function formatRun(r: BlenderRun, extra?: string): ReturnType<typeof text> {
  if (r.ok) {
    const body = r.result !== undefined ? JSON.stringify(r.result, null, 2) : "(script produced no @@TUFAN_RESULT@@ output)";
    return text(extra ? `${body}\n${extra}` : body);
  }
  if (r.pythonError) {
    return errorText(`Blender script error:\n${r.pythonError}`);
  }
  return errorText(`${r.error ?? "Blender failed"}\n--- stderr tail ---\n${r.stderrTail}\n--- stdout tail ---\n${r.stdoutTail}`);
}

export function registerBlenderTools(server: McpServer) {
  server.registerTool(
    "blender_process",
    {
      description:
        "Run a canned headless-Blender operation on a local 3D file (.glb/.gltf/.fbx/.obj/.blend in; " +
        ".glb/.fbx out — input is never modified). Actions: inspect (Roblox-readiness lint: tri counts " +
        "vs the 20k limit, materials-per-mesh, UV sets, texture sizes vs the 1024 cap), decimate (reduce " +
        "to `target` tris, default 20000), split_by_material (one object per material — Roblox imports " +
        "one MeshPart per material object), split_chunks (bisect oversized meshes into ≤`target`-tri " +
        "pieces), fracture (Cell Fracture shards for destructibles — needs the Cell Fracture extension " +
        "installed), set_origins (per-object geometry-median origins), convert (re-export, e.g. obj→glb " +
        "for import_file), downscale_textures (cap textures at `texLimit`, default 1024). Needs Blender " +
        "installed (free) — auto-detected or TUFAN_BLENDER_PATH.",
      inputSchema: {
        inputFile: z.string().describe("Absolute path of the local 3D file to process"),
        action: z.enum(CANNED_OPS as [string, ...string[]]).describe("Which canned operation to run"),
        outputFile: z
          .string()
          .optional()
          .describe("Output path (.glb or .fbx). Default: <input dir>/<name>.<action>.glb (inspect: none)"),
        target: z.number().optional().describe("Tri-count target for decimate/split_chunks (default 20000)"),
        shards: z.number().optional().describe("Shard count for fracture (default 10)"),
        texLimit: z.number().optional().describe("Max texture dimension for downscale_textures (default 1024)"),
        timeoutSeconds: z.number().optional().describe("Max seconds for the Blender run (default 180, max 600)"),
      },
    },
    async ({ inputFile, action, outputFile, target, shards, texLimit, timeoutSeconds }) => {
      const blender = await resolveBlender();
      if ("error" in blender) return errorText(blender.error);
      try {
        await stat(inputFile);
      } catch {
        return errorText(`Input file not found: ${inputFile}`);
      }

      const out =
        action === "inspect"
          ? undefined
          : outputFile ??
            join(dirname(inputFile), `${basename(inputFile, extname(inputFile))}.${action}.glb`);

      const args: Record<string, string | number> = { in: inputFile };
      if (out) args.out = out;
      if (target !== undefined) args.target = Math.round(target);
      if (shards !== undefined) args.shards = Math.round(shards);
      if (texLimit !== undefined) args.tex_limit = Math.round(texLimit);

      const r = await runBlender({
        blenderPath: blender.path,
        script: buildOpScript(action),
        args,
        timeoutMs: (timeoutSeconds ?? 180) * 1000,
        // Cell Fracture lives in the user's extension repo — factory startup would hide it.
        factoryStartup: action !== "fracture",
      });
      // A canned op that returns {error} (e.g. missing Cell Fracture) is a tool error.
      if (r.ok && r.result && typeof r.result === "object" && r.result.error) {
        return errorText(String(r.result.error));
      }
      return formatRun(r, out ? `output: ${out}` : undefined);
    },
  );

  server.registerTool(
    "blender_run",
    {
      description:
        "POWER TOOL: run an arbitrary bpy (Python) script in headless Blender on this machine. The script " +
        "gets helper globals from the Tufan preamble: ARGS (parsed k=v argv), IN/OUT (from inputFile/" +
        "outputFile), emit(dict) → returns structured JSON to the caller, plus load_input()/import_any()/" +
        "export_any()/mesh_objs()/tri_count()/inspect_report()/apply_all_modifiers()/select_only(). " +
        "End with emit({...}) to return data. Python exceptions come back as clean tracebacks. " +
        "Use blender_process for the common canned operations; this is for everything else " +
        "(procedural geometry, custom cleanup, baking, batch edits). Executes native code locally — " +
        "hidden in read-only mode. Needs Blender installed (auto-detected or TUFAN_BLENDER_PATH).",
      inputSchema: {
        script: z.string().describe("The bpy Python script body to execute"),
        inputFile: z.string().optional().describe("Local 3D file surfaced to the script as IN (use load_input())"),
        outputFile: z.string().optional().describe("Path surfaced to the script as OUT"),
        timeoutSeconds: z.number().optional().describe("Max seconds for the Blender run (default 180, max 600)"),
        factoryStartup: z
          .boolean()
          .optional()
          .describe("Run with --factory-startup (default true; set false to load user add-ons/extensions)"),
      },
    },
    async ({ script, inputFile, outputFile, timeoutSeconds, factoryStartup }) => {
      const blender = await resolveBlender();
      if ("error" in blender) return errorText(blender.error);
      if (inputFile) {
        try {
          await stat(inputFile);
        } catch {
          return errorText(`Input file not found: ${inputFile}`);
        }
      }
      const args: Record<string, string> = {};
      if (inputFile) args.in = inputFile;
      if (outputFile) args.out = outputFile;
      const r = await runBlender({
        blenderPath: blender.path,
        script: buildUserScript(script),
        args,
        timeoutMs: (timeoutSeconds ?? 180) * 1000,
        factoryStartup,
      });
      return formatRun(r, outputFile ? `output (if written): ${outputFile}` : undefined);
    },
  );
}

export { BLENDER_HELP };
