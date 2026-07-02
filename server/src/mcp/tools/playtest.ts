import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerPlaytestTools(server: McpServer) {
  server.registerTool(
    "playtest",
    {
      description:
        "Control a Studio RUN-mode simulation (RunService). action='start' runs server scripts + " +
        "physics in the SAME session, so run_luau / playtest_probe / get_output_log keep working " +
        "DURING the run (the build→test→inspect→fix loop) — no player character (full Play Solo/F5 has " +
        "no plugin API, start that manually). 'stop' ends it; 'pause' suspends physics + scripts. " +
        "(Replaces start_playtest + stop_playtest + pause_playtest.) Check state with is_running.",
      inputSchema: {
        action: z.enum(["start", "stop", "pause"]),
        place: placeArg,
      },
    },
    async ({ action, place }) => {
      const op = action === "start" ? "startPlaytest" : action === "stop" ? "stopPlaytest" : "pausePlaytest";
      const fallback = action === "start" ? "Run mode started" : action === "stop" ? "stopped" : "paused";
      return runStudio(op, {}, (r) => r?.note ?? fallback, place);
    },
  );

  server.registerTool(
    "is_running",
    { description: "Whether a simulation is running, and whether it's Run mode.", inputSchema: { place: placeArg } },
    async ({ place }) =>
      runStudio("isRunning", {}, (r) => (r?.running ? `running${r.runMode ? " (run mode)" : ""}` : "not running (edit mode)"), place),
  );

  server.registerTool(
    "playtest_probe",
    {
      description:
        "Run Luau INSIDE a running simulation and get STRUCTURED data back (tables → JSON) — the " +
        "AI's eyes during a test: read player count, positions, values, whatever. Works in Run mode " +
        "(playtest action:'start'). Errors if nothing is running. Omit code for a default player snapshot. " +
        "For EDIT-mode code (nothing running), use run_luau instead; for code against the PUBLISHED game, use cloud_luau instead.",
      inputSchema: {
        code: z.string().optional().describe("Luau to run in the sim; return a table for structured output"),
        place: placeArg,
      },
    },
    async ({ code, place }) =>
      runStudio("playtestProbe", { code }, (r) => {
        const out: string[] = [];
        if (r?.logs?.length) out.push("-- output --\n" + r.logs.join("\n"));
        if (r?.result !== undefined && r?.result !== null)
          out.push("-- return --\n" + (typeof r.result === "object" ? JSON.stringify(r.result, null, 2) : String(r.result)));
        return out.length ? out.join("\n\n") : "(ran, no output)";
      }, place),
  );

  server.registerTool(
    "playtest_input",
    {
      description:
        "Drive the CHARACTER during a playtest with synthetic keyboard/mouse (VirtualInputManager). " +
        "Input is global to the Studio window, so this works in a manual Play Solo (F5) session — the " +
        "part Run mode can't give you. events = ordered list of: {type:'key',key:'W',duration} | " +
        "{type:'keyDown'|'keyUp',key} | {type:'click',x,y,button} | {type:'mouseMove',x,y} | " +
        "{type:'wait',seconds}. Pair with capture_screenshot to see the result.",
      inputSchema: {
        events: z
          .array(
            z.object({
              type: z.enum(["key", "keyDown", "keyUp", "click", "mouseMove", "wait"]),
              key: z.string().optional().describe("KeyCode name, e.g. W, Space, E"),
              duration: z.number().optional().describe("hold seconds for type:key"),
              x: z.number().optional(),
              y: z.number().optional(),
              button: z.enum(["left", "right"]).optional(),
              seconds: z.number().optional().describe("for type:wait"),
            }),
          )
          .describe("ordered input events"),
        place: placeArg,
      },
    },
    async ({ events, place }) =>
      runStudio("playtestInput", { events }, (r) => `sent ${r?.sent?.length ?? 0} input event(s): ${(r?.sent ?? []).join(", ")}`, place),
  );
}
