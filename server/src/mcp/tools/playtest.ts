import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerPlaytestTools(server: McpServer) {
  server.registerTool(
    "start_playtest",
    {
      description:
        "Start a Studio RUN-mode simulation (RunService:Run) — runs server scripts + physics in the SAME session, so run_luau and get_playtest_output keep working DURING the run (the automated build→test→inspect→fix loop). No player character is spawned: full Play Solo (F5) has no plugin API and must be started manually. Stop with stop_playtest.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => runStudio("startPlaytest", {}, (r) => r?.note ?? "Run mode started", place),
  );

  server.registerTool(
    "stop_playtest",
    { description: "Stop the running simulation (RunService:Stop).", inputSchema: { place: placeArg } },
    async ({ place }) => runStudio("stopPlaytest", {}, (r) => r?.note ?? "stopped", place),
  );

  server.registerTool(
    "pause_playtest",
    { description: "Pause the running simulation — physics + scripts suspended (RunService:Pause).", inputSchema: { place: placeArg } },
    async ({ place }) => runStudio("pausePlaytest", {}, (r) => r?.note ?? "paused", place),
  );

  server.registerTool(
    "is_running",
    { description: "Whether a simulation is running, and whether it's Run mode.", inputSchema: { place: placeArg } },
    async ({ place }) =>
      runStudio("isRunning", {}, (r) => (r?.running ? `running${r.runMode ? " (run mode)" : ""}` : "not running (edit mode)"), place),
  );
}
