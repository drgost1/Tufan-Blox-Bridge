import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerLuauTools(server: McpServer) {
  server.registerTool(
    "run_luau",
    {
      description:
        "Execute Luau in the Studio plugin context (edit mode). Captures the return value and anything printed. Has full plugin API access — use for inspection and one-off mutations.",
      inputSchema: { code: z.string().describe("Luau source to run") },
    },
    async ({ code }) =>
      runStudio("runLuau", { code }, (r) => {
        const out: string[] = [];
        if (r?.logs?.length) out.push("-- output --\n" + r.logs.join("\n"));
        if (r?.result !== undefined && r?.result !== null) out.push("-- return --\n" + String(r.result));
        if (!out.length) return "(no output, no return value)";
        return out.join("\n\n");
      }),
  );
}
