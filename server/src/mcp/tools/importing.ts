import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { resolveTargetPlace, dispatchTo } from "../../bridge/sessions.js";
import { bumpPlace } from "../../bridge/cache.js";

// Local file → Roblox, via the Open Cloud Assets API. The server runs on the
// user's machine, so it reads the file straight from disk, uploads it under the
// user's own account (they OWN the result — so LoadAsset insertion always
// authorizes, unlike third-party marketplace assets), then inserts it into the
// open place through the existing plugin ops. No plugin change needed.
//
// API: POST https://apis.roblox.com/assets/v1/assets (multipart) responds with
// { path: "operations/{id}" }; poll GET /assets/v1/operations/{id} until done,
// then read response.assetId + response.moderationResult.moderationState.
// Docs: https://create.roblox.com/docs/cloud/guides/usage-assets

const OC_BASE = "https://apis.roblox.com/assets/v1";
const MAX_BYTES = 20 * 1024 * 1024; // Open Cloud hard cap per (non-video) request

type AssetKind = "Model" | "Audio" | "Decal" | "Animation";

// extension → { assetType, mime }. assetType must be the friendly enum in the
// request ("Model"/"Audio"/"Decal"); the ASSET_TYPE_* form only appears in
// responses. .rbxm and .rbxmx both use model/x-rbxm (the API auto-detects).
const FORMATS: Record<string, { assetType: AssetKind; mime: string }> = {
  ".rbxm": { assetType: "Model", mime: "model/x-rbxm" },
  ".rbxmx": { assetType: "Model", mime: "model/x-rbxm" },
  ".fbx": { assetType: "Model", mime: "model/fbx" },
  ".gltf": { assetType: "Model", mime: "model/gltf+json" },
  ".glb": { assetType: "Model", mime: "model/gltf-binary" },
  ".mp3": { assetType: "Audio", mime: "audio/mpeg" },
  ".ogg": { assetType: "Audio", mime: "audio/ogg" },
  ".wav": { assetType: "Audio", mime: "audio/wav" },
  ".flac": { assetType: "Audio", mime: "audio/flac" },
  ".png": { assetType: "Decal", mime: "image/png" },
  ".jpg": { assetType: "Decal", mime: "image/jpeg" },
  ".jpeg": { assetType: "Decal", mime: "image/jpeg" },
  ".bmp": { assetType: "Decal", mime: "image/bmp" },
  ".tga": { assetType: "Decal", mime: "image/tga" },
};

const KEY_HELP =
  "import_file needs a Roblox Open Cloud API key:\n" +
  "  1. https://create.roblox.com/dashboard/credentials → Create API Key\n" +
  "  2. Add the 'assets' API system with Read + Write operations\n" +
  "  3. Under Access Permissions add the user (or group) that should own the uploads\n" +
  "  4. Leave 'Restrict IP addresses' OFF (a local server has no fixed IP)\n" +
  "  5. Set TUFAN_OPENCLOUD_KEY=<key> in the tufan MCP server env, restart the AI client\n" +
  "Optional: TUFAN_CREATOR_ID=<userId> (defaults to the logged-in Studio user), or " +
  "TUFAN_GROUP_ID=<groupId> to upload as a group.";

/** Never echo the API key back to the model, even via a reflected HTTP body. */
function scrub(s: string, key: string): string {
  return key ? s.split(key).join("***") : s;
}

/** Resolve who owns the upload: env override, else the logged-in Studio user. */
async function resolveCreator(
  place?: string | number,
): Promise<{ creator?: Record<string, string>; error?: string }> {
  if (process.env.TUFAN_GROUP_ID) return { creator: { groupId: String(process.env.TUFAN_GROUP_ID).trim() } };
  if (process.env.TUFAN_CREATOR_ID) return { creator: { userId: String(process.env.TUFAN_CREATOR_ID).trim() } };
  const target = resolveTargetPlace(place);
  if (target.error) {
    return { error: `Set TUFAN_CREATOR_ID (no Studio connected to auto-detect the user: ${target.error})` };
  }
  try {
    // runLuau returns primitives stringified in `.result` (tables go to `.resultJson`).
    const r: any = await dispatchTo(target.placeId!, "runLuau", {
      code: "return game:GetService(\"StudioService\"):GetUserId()",
    });
    const id = Number(r?.result ?? r?.resultJson);
    if (Number.isFinite(id) && id > 0) return { creator: { userId: String(id) } };
    return { error: "Could not auto-detect the logged-in Studio user id — set TUFAN_CREATOR_ID." };
  } catch (e) {
    return { error: `User-id auto-detect failed (${(e as Error).message}) — set TUFAN_CREATOR_ID.` };
  }
}

/** Poll an Open Cloud operation until done or the deadline passes (null = still pending). */
async function pollOperation(operationId: string, key: string, waitMs: number): Promise<any | null> {
  const deadline = Date.now() + waitMs;
  let delay = 1000;
  for (;;) {
    // Cap each poll fetch by the remaining budget so the loop can't overrun waitMs.
    const remaining = Math.max(1_000, deadline - Date.now());
    const res = await fetch(`${OC_BASE}/operations/${operationId}`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(Math.min(15_000, remaining)),
    });
    if (res.ok) {
      const j: any = await res.json();
      if (j.done) return j;
    } else if (res.status !== 429) {
      throw new Error(`operation poll HTTP ${res.status}: ${scrub((await res.text()).slice(0, 300), key)}`);
    }
    if (Date.now() + delay > deadline) return null;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.7), 10_000);
  }
}

/**
 * Map a response assetType (ASSET_TYPE_* or friendly) back to our kind.
 * Returns null when the response doesn't say — callers must NOT guess Model,
 * or an audio/image id would go through LoadAsset and fail confusingly.
 */
function kindFromResponse(responseType: string | undefined): AssetKind | null {
  const t = String(responseType ?? "").toUpperCase();
  if (!t) return null;
  if (t.includes("AUDIO")) return "Audio";
  if (t.includes("DECAL") || t.includes("IMAGE")) return "Decal";
  if (t.includes("ANIMATION")) return "Animation";
  if (t.includes("MODEL") || t.includes("MESH")) return "Model";
  return null;
}

/** Insert the uploaded asset into the place; returns a human line (never throws). */
async function insertIntoPlace(
  kind: AssetKind,
  assetId: string,
  displayName: string,
  parentPath: string | undefined,
  place?: string | number,
): Promise<string> {
  const target = resolveTargetPlace(place);
  if (target.error) return `(not inserted — ${target.error})`;
  const parent = parentPath ?? "Workspace";
  try {
    if (kind === "Model") {
      const r: any = await dispatchTo(target.placeId!, "insertAsset", {
        assetId: Number(assetId),
        parentPath: parent,
      });
      bumpPlace(target.placeId!);
      return `inserted at ${r?.path ?? parent}`;
    }
    // Audio/Decal/Animation: create the wrapper instance, then VERIFY the id
    // property actually stuck — the plugin pcall-swallows failed property sets,
    // so a bare "created" would be an unverified success claim.
    const wrapper: Record<Exclude<AssetKind, "Model">, { className: string; prop: string }> = {
      Audio: { className: "Sound", prop: "SoundId" },
      Decal: { className: "Decal", prop: "Texture" },
      Animation: { className: "Animation", prop: "AnimationId" },
    };
    const w = wrapper[kind as Exclude<AssetKind, "Model">];
    const contentId = `rbxassetid://${assetId}`;
    const created: any = await dispatchTo(target.placeId!, "createInstance", {
      className: w.className,
      parentPath: parent,
      name: displayName,
      properties: { [w.prop]: contentId },
    });
    bumpPlace(target.placeId!);
    const path = created?.path ?? parent;
    try {
      const check: any = await dispatchTo(target.placeId!, "getProperties", { path, names: [w.prop] });
      const got = String(check?.[w.prop] ?? "");
      if (!got.includes(assetId)) {
        return `created ${w.className} at ${path}, but ${w.prop} didn't stick (reads "${got}") — set it to ${contentId} manually`;
      }
    } catch {
      return `created ${w.className} at ${path} (${w.prop} set to ${contentId}, read-back check unavailable)`;
    }
    return `inserted ${w.className} at ${path} (${w.prop} = ${contentId}, verified)`;
  } catch (e) {
    return `(upload succeeded but insert failed: ${(e as Error).message} — insert manually with rbxassetid://${assetId})`;
  }
}

/** Format the final result of a completed upload operation. */
async function finishOperation(
  op: any,
  kindHint: AssetKind | undefined,
  displayName: string,
  insert: boolean,
  parentPath: string | undefined,
  place?: string | number,
) {
  const assetId: string | undefined = op?.response?.assetId;
  if (!assetId) return errorText(`Upload finished but no assetId in response: ${JSON.stringify(op).slice(0, 400)}`);
  // The response's own assetType wins; fall back to what the caller knew.
  const resolvedKind = kindFromResponse(op?.response?.assetType) ?? kindHint ?? null;
  // Observed live: the API returns "Approved" (mixed case), not the documented
  // MODERATION_STATE_APPROVED — compare case-insensitively.
  const modState = String(op?.response?.moderationResult?.moderationState ?? "");
  const lines = [`Uploaded "${op?.response?.displayName ?? displayName}" → assetId ${assetId} (rbxassetid://${assetId})`];
  if (modState && !modState.toUpperCase().includes("APPROVED")) {
    lines.push(
      `⚠ moderation: ${modState} — the asset exists but stays private/unusable until Roblox approves it` +
        (resolvedKind === "Audio" ? " (audio review can take a while)" : ""),
    );
  }
  if (insert) {
    if (!resolvedKind) {
      lines.push(
        `(not auto-inserted — couldn't determine the asset type from the operation; ` +
          `re-run with { operationId, assetType } or insert manually with rbxassetid://${assetId})`,
      );
    } else {
      lines.push(await insertIntoPlace(resolvedKind, assetId, displayName, parentPath, place));
    }
  }
  return text(lines.join("\n"));
}

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
      if (!key) return errorText(KEY_HELP);
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
        const ext = extname(filePath).toLowerCase();
        if (ext === ".obj") {
          return errorText("Open Cloud doesn't accept .obj — convert to .fbx or .glb (e.g. in Blender) and retry.");
        }
        const fmt = FORMATS[ext];
        if (!fmt) {
          return errorText(`Unsupported extension "${ext}". Supported: ${Object.keys(FORMATS).join(" ")}`);
        }
        const kind: AssetKind = assetType ?? fmt.assetType;

        let size: number;
        try {
          size = (await stat(filePath)).size;
        } catch {
          return errorText(`File not found: ${filePath}`);
        }
        if (size > MAX_BYTES) {
          return errorText(`File is ${(size / 1048576).toFixed(1)} MB — Open Cloud caps uploads at 20 MB.`);
        }

        const creator = await resolveCreator(place);
        if (creator.error) return errorText(creator.error);

        const displayName = name ?? basename(filePath, ext);
        const buf = await readFile(filePath);
        const form = new FormData();
        form.append(
          "request",
          JSON.stringify({
            assetType: kind,
            displayName,
            description: description ?? "Uploaded via Tufan-Blox-Bridge",
            creationContext: { creator: creator.creator },
          }),
        );
        form.append("fileContent", new Blob([new Uint8Array(buf)], { type: fmt.mime }), basename(filePath));

        // Don't set Content-Type — fetch generates the multipart boundary itself.
        // The upload itself is NOT resumable, so it gets its own generous budget
        // (separate from waitSeconds, which only governs the processing poll).
        let res: Response;
        try {
          res = await fetch(`${OC_BASE}/assets`, {
            method: "POST",
            headers: { "x-api-key": key },
            body: form,
            signal: AbortSignal.timeout(120_000),
          });
        } catch (e) {
          if ((e as Error).name === "AbortError" || (e as Error).name === "TimeoutError") {
            return errorText(
              `Upload timed out after 120s sending ${(size / 1048576).toFixed(1)} MB — likely a slow ` +
                `connection, not an API problem. Retry on a faster link or with a smaller file.`,
            );
          }
          throw e;
        }
        if (!res.ok) {
          const body = scrub((await res.text()).slice(0, 400), key);
          if (res.status === 401 || res.status === 403) {
            return errorText(`Upload rejected (HTTP ${res.status}): ${body}\n\nKey/permission problem — check:\n${KEY_HELP}`);
          }
          if (res.status === 429) {
            return errorText(
              `Rate/quota limited (HTTP 429): ${body}` +
                (kind === "Audio" ? "\nAudio quota: 10 uploads/month (100/month if ID-verified)." : ""),
            );
          }
          return errorText(`Upload failed (HTTP ${res.status}): ${body}`);
        }

        // The create POST responds with just { path: "operations/{id}" }.
        const initial: any = await res.json();
        const opId: string | undefined =
          typeof initial?.path === "string" && initial.path.startsWith("operations/")
            ? initial.path.split("/").pop()
            : undefined;
        if (!opId) {
          return errorText(`Upload accepted but no operation path returned: ${scrub(JSON.stringify(initial).slice(0, 300), key)}`);
        }

        const op = await pollOperation(opId, key, waitMs);
        if (!op) {
          return text(
            `Upload accepted — Roblox is still processing (common for audio/moderation).\n` +
              `Resume with: import_file({ operationId: "${opId}"${kind !== "Model" ? `, assetType: "${kind}"` : ""} })`,
          );
        }
        return await finishOperation(op, kind, displayName, doInsert, parentPath, place);
      } catch (e) {
        return errorText(`import_file failed: ${scrub((e as Error).message, key)}`);
      }
    },
  );
}
