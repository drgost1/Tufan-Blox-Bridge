import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import {
  OC_KEY_HELP,
  scrub,
  pollOperation,
  finishOperation,
  uploadFile,
} from "../../openCloud.js";

// Local file → Roblox, via the Open Cloud Assets API. The server runs on the
// user's machine, so it reads the file straight from disk, uploads it under the
// user's own account (they OWN the result — so LoadAsset insertion always
// authorizes, unlike third-party marketplace assets), then inserts it into the
// open place through the existing plugin ops. No plugin change needed.
//
// The Open Cloud upload/poll/insert core lives in src/openCloud.ts (shared with
// generate_asset) — this file is just the import_file tool surface.

export function registerImportTools(server: McpServer) {
  server.registerTool(
    "import_file",
    {
      description:
        "Import a LOCAL file into Roblox: uploads it to the user's own account via the Open Cloud " +
        "Assets API (needs TUFAN_OPENCLOUD_KEY), then inserts it into the open place. " +
        "Supports .rbxm/.rbxmx/.fbx/.gltf/.glb (Model), .mp3/.ogg/.wav/.flac (Audio → Sound instance; " +
        "wav/flac acceptance may vary), .png/.jpg/.bmp/.tga (Decal instance). NOT .obj — convert to " +
        ".fbx/.glb first. Max 20 MB. Audio uploads are quota-limited (10/month, 100/month if ID-verified) " +
        "and queue for moderation — they often outlive waitSeconds; when that happens the call returns an " +
        "operationId, and re-calling with { operationId } resumes WITHOUT re-uploading or burning quota. " +
        "Models typically finish in seconds.",
      inputSchema: {
        filePath: z.string().optional().describe("Absolute path of the local file to upload"),
        name: z.string().optional().describe("Display name on Roblox (default: file name)"),
        description: z.string().optional(),
        assetType: z
          .enum(["Model", "Audio", "Decal", "Animation"])
          .optional()
          .describe("Override auto-detect — e.g. Animation for a KeyframeSequence .rbxm"),
        parentPath: z.string().optional().describe("Where to insert in the place (default Workspace)"),
        insert: z.boolean().optional().describe("Insert into the place after upload (default true)"),
        waitSeconds: z
          .number()
          .optional()
          .describe("Max seconds to wait for Roblox-side processing after upload (default 45, max 240)"),
        operationId: z.string().optional().describe("Resume a pending upload instead of uploading again"),
        place: placeArg,
      },
    },
    async ({ filePath, name, description, assetType, parentPath, insert, waitSeconds, operationId, place }) => {
      const key = process.env.TUFAN_OPENCLOUD_KEY?.trim();
      if (!key) return errorText(OC_KEY_HELP);
      const waitMs = Math.min(Math.max(waitSeconds ?? 45, 5), 240) * 1000;
      const doInsert = insert !== false;

      try {
        // Resume path: poll an existing operation, then insert.
        if (operationId) {
          const op = await pollOperation(operationId, key, waitMs);
          if (!op) return errorText(`Operation ${operationId} still processing — retry with the same operationId.`);
          return await finishOperation(op, assetType, name ?? "imported asset", doInsert, parentPath, place);
        }

        if (!filePath) return errorText("Provide filePath (or operationId to resume a pending upload).");

        const up = await uploadFile({ filePath, assetType, displayName: name, description, key, place });
        if (!up.ok) return up.error;

        const op = await pollOperation(up.operationId, key, waitMs);
        if (!op) {
          return text(
            `Upload accepted — Roblox is still processing (common for audio/moderation).\n` +
              `Resume with: import_file({ operationId: "${up.operationId}"${up.kind !== "Model" ? `, assetType: "${up.kind}"` : ""} })`,
          );
        }
        return await finishOperation(op, up.kind, up.displayName, doInsert, parentPath, place);
      } catch (e) {
        return errorText(`import_file failed: ${scrub((e as Error).message, key)}`);
      }
    },
  );
}
