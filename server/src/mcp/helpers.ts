// Shared helpers for tool handlers.

import { dispatch } from "../bridge/queue.js";

// Index signature required so this is assignable to the SDK's CallToolResult.
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

export function json(value: unknown): ToolText {
  return text(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

/**
 * Dispatch an op to the plugin and wrap the result as MCP text content.
 * `format` turns the plugin's raw result into a string.
 */
export async function runStudio(
  op: string,
  args: Record<string, unknown>,
  format: (result: any) => string = (r) => (typeof r === "string" ? r : JSON.stringify(r, null, 2)),
): Promise<ToolText> {
  try {
    const result = await dispatch(op, args);
    return text(format(result));
  } catch (e) {
    return errorText(`${op} failed: ${(e as Error).message}`);
  }
}
