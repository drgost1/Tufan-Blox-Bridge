import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerPlaytestTools(server: McpServer) {
  server.registerTool(
    "start_playtest",
    {
      description: "Start a Studio playtest (Play Solo).",
      inputSchema: {},
    },
    async () => runStudio("startPlaytest", {}, () => "Playtest started"),
  );

  server.registerTool(
    "stop_playtest",
    {
      description: "Stop the running Studio playtest.",
      inputSchema: {},
    },
    async () => runStudio("stopPlaytest", {}, () => "Playtest stopped"),
  );

  server.registerTool(
    "is_running",
    {
      description: "Report whether a playtest is currently running.",
      inputSchema: {},
    },
    async () => runStudio("isRunning", {}, (r) => (r?.running ? "running" : "not running")),
  );
}
