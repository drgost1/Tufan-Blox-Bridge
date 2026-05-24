import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerLuauTools(server: McpServer) {
  server.registerTool(
    "run_luau",
    {
      description:
        "Execute Luau in the Studio plugin context (edit mode). Captures the return value and printed output. Full plugin API access.",
      inputSchema: { code: z.string().describe("Luau source to run"), place: placeArg },
    },
    async ({ code, place }) =>
      runStudio("runLuau", { code }, (r) => {
        const out: string[] = [];
        if (r?.logs?.length) out.push("-- output --\n" + r.logs.join("\n"));
        if (r?.result !== undefined && r?.result !== null) out.push("-- return --\n" + String(r.result));
        return out.length ? out.join("\n\n") : "(no output, no return value)";
      }, place),
  );
}
