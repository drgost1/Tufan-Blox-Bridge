import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, requireWritable, placeArg } from "../helpers.js";
import { resolveTargetPlace } from "../../bridge/sessions.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Per-project AI context — a persistent markdown blob per place that the agent
// reads BEFORE exploring (saves tokens, prevents false bug reports). Storage is
// local-only: ~/.tufan-blox-bridge/context/<placeId>.md, next to projects.json.
// Mixed read/write like script_source: the tool stays visible in read-only mode;
// set/append are guarded at call time via requireWritable().

const MAX_BYTES = 64 * 1024; // sane cap — this is an orientation blob, not a wiki

function contextFile(placeId: number): string {
  return join(homedir(), ".tufan-blox-bridge", "context", `${placeId}.md`);
}

/**
 * Resolve the placeId for a LOCAL-ONLY store. Unlike Studio tools, an explicit
 * numeric placeId works without a connected Studio (no session needed); a name
 * or omitted `place` falls back to the usual connected-place resolution.
 */
function resolvePlaceId(place?: string | number): { placeId?: number; error?: string } {
  if (place !== undefined && place !== null && place !== "") {
    const n = typeof place === "number" ? place : Number(place);
    if (Number.isFinite(n) && n > 0) return { placeId: n };
  }
  return resolveTargetPlace(place);
}

export function registerProjectContextTools(server: McpServer) {
  server.registerTool(
    "project_context",
    {
      description:
        "Persistent per-project AI context (markdown) stored on the MCP server at " +
        "~/.tufan-blox-bridge/context/<placeId>.md — survives sessions and is shared by every AI session that " +
        "touches this place. CALL get AT SESSION START, BEFORE exploring the place: it carries hard-won facts " +
        "(architecture, conventions, gotchas, false-bug-report traps) that save tokens and prevent wrong " +
        "conclusions. `set` overwrites the blob; `append` adds a dated entry — update it whenever you learn " +
        "something durable about the place (a confirmed bug's root cause, a naming convention, a do-not-touch " +
        "area). get works in read-only mode; set/append are write-gated. An explicit numeric PlaceId works even " +
        "with no Studio connected (storage is local).",
      inputSchema: {
        action: z.enum(["get", "set", "append"]).describe("get = read the blob; set = overwrite it (needs content); append = add a dated entry (needs content)"),
        content: z.string().optional().describe("markdown content (required for set/append). Total stored size is capped at 64 KB."),
        place: placeArg,
      },
    },
    async ({ action, content, place }) => {
      const t = resolvePlaceId(place);
      if (t.error) return errorText(t.error);
      const file = contextFile(t.placeId!);

      if (action === "get") {
        if (!existsSync(file)) {
          return text(
            `(no project context stored yet for place ${t.placeId} — capture durable facts as you work with ` +
              `project_context action:"set" (or action:"append"), and future sessions will start oriented)`,
          );
        }
        const body = readFileSync(file, "utf8");
        return text(`project context for place ${t.placeId} (${file}):\n\n${body}`);
      }

      // set / append — writes, guarded in read-only mode.
      const blocked = requireWritable();
      if (blocked) return blocked;
      if (content === undefined || content === "") return errorText(`${action} needs \`content\`.`);

      const existing = action === "append" && existsSync(file) ? readFileSync(file, "utf8") : "";
      const next =
        action === "set"
          ? content
          : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}\n## ${new Date().toISOString().slice(0, 10)}\n\n${content}\n`;
      if (Buffer.byteLength(next, "utf8") > MAX_BYTES) {
        return errorText(
          `project context would exceed the 64 KB cap (${Math.ceil(Buffer.byteLength(next, "utf8") / 1024)} KB) — ` +
            `trim it with action:"set" (keep only what's durable), not action:"append".`,
        );
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, next, "utf8");
      return text(
        action === "set"
          ? `✓ project context set for place ${t.placeId} (${Math.ceil(Buffer.byteLength(next, "utf8") / 1024)} KB)`
          : `✓ appended to project context for place ${t.placeId} (now ${Math.ceil(Buffer.byteLength(next, "utf8") / 1024)} KB)`,
      );
    },
  );
}
