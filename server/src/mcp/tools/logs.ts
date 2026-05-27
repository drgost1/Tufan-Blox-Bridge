import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, placeIdFor, text, errorText } from "../helpers.js";
import { readEvents } from "../../bridge/feed.js";

export function registerLogTools(server: McpServer) {
  server.registerTool(
    "get_recent_errors",
    {
      description:
        "Errors + warnings the plugin has pushed live (incl. during a playtest), read from " +
        "the server feed with NO Studio round-trip — returns instantly even while the place " +
        "is busy running. Pass `since` (the cursor from the previous call) to get only NEW " +
        "events, so you can poll a running playtest cheaply. Script + line are parsed out.",
      inputSchema: {
        since: z.number().optional().describe("only events after this seq cursor (from a prior call)"),
        severity: z.enum(["error", "warning"]).optional(),
        place: placeArg,
      },
    },
    async ({ since, severity, place }) => {
      const t = placeIdFor(place);
      if (t.error) return errorText(t.error);
      const { events, cursor } = readEvents(t.placeId!, { since, severity });
      if (!events.length) return text(`(no new errors — cursor ${cursor})`);
      const lines = events.map((e) => {
        const loc = e.script ? ` @ ${e.script}:${e.line}` : "";
        return `#${e.seq} [${e.sev}]${loc} ${e.msg}`;
      });
      return text(`cursor ${cursor} — ${events.length} event(s)\n` + lines.join("\n"));
    },
  );

  server.registerTool(
    "get_output_log",
    {
      description: "Recent Studio Output messages (edit mode). Optionally filter by severity.",
      inputSchema: {
        maxEntries: z.number().optional(),
        severity: z.enum(["output", "info", "warning", "error"]).optional(),
        place: placeArg,
      },
    },
    async ({ maxEntries, severity, place }) =>
      runStudio("getOutputLog", { maxEntries: maxEntries ?? 100, severity: severity ?? null }, (r) =>
        Array.isArray(r?.lines) && r.lines.length ? r.lines.join("\n") : "(log empty)",
        place,
      ),
  );

  // get_playtest_output killed → get_output_log reads the same ring buffer (it
  // already includes streamed playtest output). get_recent_errors is the live feed.
}
