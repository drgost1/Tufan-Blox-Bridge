import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerLuauTools(server: McpServer) {
  server.registerTool(
    "run_luau",
    {
      description:
        "Execute Luau in the Studio plugin context against the EDIT copy of the place (not a running play test), with full plugin API access; returns the return value and printed output. It can change anything, so prefer the dedicated tools for routine edits. " +
        "The code runs on Studio's main thread: in any loop that may run for more than a moment (raycasts, builds, scans), call the provided checkpoint() each iteration. It yields one frame every 50 ms, and without it Studio freezes and offers to stop the plugin after about 10 seconds. " +
        "For code inside a live play session use Roblox's official Studio MCP (execute_luau); for code against the PUBLISHED game use cloud_luau.",
      inputSchema: {
        code: z.string().describe("Luau source to run. Use return to send a value back; tables come back as JSON. checkpoint() is available as a global."),
        timeoutBudget: z.number().min(1).max(85).optional().describe("Seconds to wait for code that yields before reporting it as stuck. Default 30, max 85."),
        place: placeArg,
      },
    },
    async ({ code, timeoutBudget, place }) =>
      runStudio("runLuau", { code, timeoutBudget }, (r) => {
        const out: string[] = [];
        if (r?.warning) out.push(`-- warning --\n${r.warning}`);
        if (r?.logs?.length) out.push("-- output --\n" + r.logs.join("\n"));
        // tables come back as structured JSON (resultJson); primitives as `result`
        if (r?.resultJson !== undefined && r?.resultJson !== null) out.push("-- return --\n" + JSON.stringify(r.resultJson, null, 2));
        else if (r?.result !== undefined && r?.result !== null) out.push("-- return --\n" + String(r.result));
        return out.length ? out.join("\n\n") : "(no output, no return value)";
      }, place),
  );
}
