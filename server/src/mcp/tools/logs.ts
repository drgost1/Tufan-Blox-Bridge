import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, placeIdFor, text, errorText } from "../helpers.js";
import { readEvents } from "../../bridge/feed.js";

export function registerLogTools(server: McpServer) {
  server.registerTool(
    "get_recent_errors",
    {
      description:
        "Read the errors and warnings Studio has produced, including during a play test, with script and line parsed out. Read-only. " +
        "It reads the feed the plugin already pushed, so it answers instantly even while Studio is busy. Pass the cursor from the previous reply as since to get only new events. " +
        "For all Output text (prints and info) use get_output_log; for your published game's live servers use get_server_logs.",
      inputSchema: {
        since: z.number().optional().describe("Cursor from a previous reply; only events after it are returned. Omit for everything still in the feed."),
        severity: z.enum(["error", "warning"]).optional().describe("Return only errors or only warnings. Omit for both."),
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
      description:
        "Read recent lines from Studio's Output window, prints included, newest last. Read-only. The plugin keeps the last 1,500 messages, play test output included. " +
        "Use it to see what a script printed; for errors only, with script and line parsed, get_recent_errors is faster.",
      inputSchema: {
        maxEntries: z.number().int().min(1).optional().describe("How many of the most recent lines to return. Default 100."),
        severity: z.enum(["output", "info", "warning", "error"]).optional().describe("Return only this message type. Omit for all."),
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
