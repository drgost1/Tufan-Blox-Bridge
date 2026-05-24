import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerLogTools(server: McpServer) {
  server.registerTool(
    "get_output_log",
    {
      description: "Return recent Studio Output messages (edit mode). Optionally filter by severity.",
      inputSchema: {
        maxEntries: z.number().optional(),
        severity: z.enum(["output", "info", "warning", "error"]).optional(),
      },
    },
    async ({ maxEntries, severity }) =>
      runStudio("getOutputLog", { maxEntries: maxEntries ?? 100, severity: severity ?? null }, (r) =>
        Array.isArray(r?.lines) && r.lines.length ? r.lines.join("\n") : "(log empty)",
      ),
  );

  server.registerTool(
    "get_playtest_output",
    {
      description: "Return output captured during the most recent / current playtest session.",
      inputSchema: { maxEntries: z.number().optional() },
    },
    async ({ maxEntries }) =>
      runStudio("getPlaytestOutput", { maxEntries: maxEntries ?? 100 }, (r) =>
        Array.isArray(r?.lines) && r.lines.length ? r.lines.join("\n") : "(no playtest output)",
      ),
  );
}
