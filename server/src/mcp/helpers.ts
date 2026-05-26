// Shared helpers for tool handlers.

import { z } from "zod";
import { dispatchTo, resolveTargetPlace } from "../bridge/sessions.js";
import { cacheGet, cacheSet, bumpPlace } from "../bridge/cache.js";

// Internal ops that mutate the place. After any of these runs, the place's read
// cache is cleared so the next get_descendants / get_tree reflects the change.
const WRITE_OPS = new Set([
  "createInstance", "deleteInstance", "cloneInstance", "moveInstance", "renameInstance",
  "massCreate", "massDuplicate", "createTree", "undo", "redo",
  "setProperty", "massSetProperty", "massEdit", "setAttribute",
  "setScriptSource", "editScriptLines", "insertScriptLines", "deleteScriptLines", "findAndReplace",
  "addTag", "removeTag", "runLuau", "insertAsset", "batch",
]);

/** Optional target-place argument shared by every Studio tool. */
export const placeArg = z
  .union([z.string(), z.number()])
  .optional()
  .describe("Target place (PlaceId or project name). Defaults to the bound/sole connected place.");

export type ToolText = {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function text(s: string): ToolText {
  return { content: [{ type: "text", text: s }] };
}

export function errorText(s: string): ToolText {
  return { content: [{ type: "text", text: s }], isError: true };
}

/**
 * Dispatch an op to a target Studio place and wrap the result as MCP text.
 * `place` (optional) is a PlaceId or project name; defaults to the bound/sole place.
 */
export async function runStudio(
  op: string,
  args: Record<string, unknown>,
  format: (result: any) => string = (r) => (typeof r === "string" ? r : JSON.stringify(r, null, 2)),
  place?: string | number,
): Promise<ToolText> {
  const target = resolveTargetPlace(place);
  if (target.error) return errorText(target.error);
  try {
    const result = await dispatchTo(target.placeId!, op, args);
    if (WRITE_OPS.has(op)) bumpPlace(target.placeId!);
    return text(format(result));
  } catch (e) {
    return errorText(`${op} failed: ${(e as Error).message}`);
  }
}

/**
 * Like runStudio, but memoizes the formatted result per place for `ttlMs`. For
 * read-only tree dumps (get_descendants / get_tree): a repeat read is instant and
 * free; any write through the bridge clears the cache (see WRITE_OPS + bumpPlace).
 */
export async function runStudioCached(
  op: string,
  args: Record<string, unknown>,
  format: (result: any) => string,
  place?: string | number,
  ttlMs = 4000,
): Promise<ToolText> {
  const target = resolveTargetPlace(place);
  if (target.error) return errorText(target.error);
  const key = `${op}:${JSON.stringify(args)}`;
  const hit = cacheGet(target.placeId!, key, ttlMs);
  if (hit !== undefined) return text(hit);
  try {
    const result = await dispatchTo(target.placeId!, op, args);
    const formatted = format(result);
    cacheSet(target.placeId!, key, formatted);
    return text(formatted);
  } catch (e) {
    return errorText(`${op} failed: ${(e as Error).message}`);
  }
}

/** Resolve a place arg to its placeId for tools that read server-side state. */
export function placeIdFor(place?: string | number): { placeId?: number; error?: string } {
  return resolveTargetPlace(place);
}
