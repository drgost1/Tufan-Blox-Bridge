import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerPlaytestTools(server: McpServer) {
  server.registerTool(
    "start_playtest",
    { description: "Start a Studio playtest. (Unsupported — no plugin API; press F5.)", inputSchema: { place: placeArg } },
    async ({ place }) => runStudio("startPlaytest", {}, () => "Playtest started", place),
  );

  server.registerTool(
    "stop_playtest",
    { description: "Stop the running playtest. (Unsupported — no plugin API; press Shift+F5.)", inputSchema: { place: placeArg } },
    async ({ place }) => runStudio("stopPlaytest", {}, () => "Playtest stopped", place),
  );

  server.registerTool(
    "is_running",
    { description: "Whether a playtest is currently running.", inputSchema: { place: placeArg } },
    async ({ place }) => runStudio("isRunning", {}, (r) => (r?.running ? "running" : "not running"), place),
  );
}
