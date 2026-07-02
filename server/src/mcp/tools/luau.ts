import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerLuauTools(server: McpServer) {
  server.registerTool(
    "run_luau",
    {
      description:
        "Execute Luau in the Studio plugin context (EDIT mode — runs against the edit DataModel, not a running playtest's server/client). Captures the return value and printed output. Full plugin API access. " +
        "For code that must run INSIDE a live Run-mode/Play-Solo simulation, use playtest_probe instead; for code that must run against the PUBLISHED game on Roblox's servers, use cloud_luau instead.",
      inputSchema: { code: z.string().describe("Luau source to run"), place: placeArg },
    },
    async ({ code, place }) =>
      runStudio("runLuau", { code }, (r) => {
        const out: string[] = [];
        if (r?.logs?.length) out.push("-- output --\n" + r.logs.join("\n"));
        // tables now come back as structured JSON (resultJson); primitives as `result`
        if (r?.resultJson !== undefined && r?.resultJson !== null) out.push("-- return --\n" + JSON.stringify(r.resultJson, null, 2));
        else if (r?.result !== undefined && r?.result !== null) out.push("-- return --\n" + String(r.result));
        return out.length ? out.join("\n\n") : "(no output, no return value)";
      }, place),
  );
}
