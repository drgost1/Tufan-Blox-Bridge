import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerLogTools(server: McpServer) {
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

  server.registerTool(
    "get_playtest_output",
    { description: "Output from the current/most-recent playtest session.", inputSchema: { maxEntries: z.number().optional(), place: placeArg } },
    async ({ maxEntries, place }) =>
      runStudio("getPlaytestOutput", { maxEntries: maxEntries ?? 100 }, (r) =>
        Array.isArray(r?.lines) && r.lines.length ? r.lines.join("\n") : "(no playtest output)",
        place,
      ),
  );
}
