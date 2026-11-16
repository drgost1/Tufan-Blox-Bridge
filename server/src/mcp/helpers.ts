// Shared helpers for tool handlers.

import { z } from "zod";
import { dispatchTo, resolveTargetPlace } from "../bridge/sessions.js";
import { runtimeConfig } from "../config.js";

/** Optional target-place argument shared by every Studio tool. */
export const placeArg = z
  .union([z.string(), z.number()])
  .optional()
  .describe("Target place (PlaceId or project name). Defaults to the bound/sole connected place.");

const PATH_FORMAT =
  'Dot path from the DataModel root, e.g. "Workspace.Map.Door" or "StarterGui.HUD.Frame". ' +
  'A leading "game." is optional; a duplicate sibling name takes the suffix Tufan prints, e.g. "Part (2)".';

/** How property and attribute values are written in tool arguments (Serialize.decodeValue on the plugin side). */
export const VALUE_FORMAT =
  "Write a primitive (string, number, boolean) or a typed wrapper: {Vector3:[x,y,z]}, {Color3:[r,g,b]} (0-1), " +
  "{UDim2:[xScale,xOffset,yScale,yOffset]}, {CFrame:[x,y,z] or all 12 components}, {EnumItem:\"Enum.Material.Wood\"}, {BrickColor:\"Bright red\"}.";

/** A required instance path argument, described once so every tool explains the format the same way. */
export function pathArg(what: string) {
  return z.string().describe(`${what}. ${PATH_FORMAT}`);
}

/** An optional instance path argument; `fallback` says what happens when it is omitted. */
export function optionalPathArg(what: string, fallback: string) {
  return z.string().optional().describe(`${what}. ${PATH_FORMAT} Omit to use ${fallback}.`);
}

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
 * Guard the write path of a mixed read/write tool (script_source, tag). Returns an
 * error ToolText to return early when read-only mode is on, else null to proceed.
 * Pure-write tools don't need this — they're hidden at registration in read-only.
 */
export function requireWritable(): ToolText | null {
  return runtimeConfig.readOnly
    ? errorText("read-only mode (TUFAN_READONLY=1) — writes are disabled in inspector mode")
    : null;
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
    return text(format(result));
  } catch (e) {
    return errorText(`${op} failed: ${(e as Error).message}`);
  }
}

/** Resolve a place arg to its placeId for tools that read server-side state. */
export function placeIdFor(place?: string | number): { placeId?: number; error?: string } {
  return resolveTargetPlace(place);
}
