// Shared helpers for tool handlers.

import { z } from "zod";
import { dispatchTo, resolveTargetPlace } from "../bridge/sessions.js";

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
    return text(format(result));
  } catch (e) {
    return errorText(`${op} failed: ${(e as Error).message}`);
  }
}
