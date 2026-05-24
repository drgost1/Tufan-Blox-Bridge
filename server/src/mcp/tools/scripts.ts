import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerScriptTools(server: McpServer) {
  server.registerTool(
    "get_script_source",
    {
      description: "Read the Source of a Script/LocalScript/ModuleScript by its full path, e.g. 'ServerScriptService.MusicService'.",
      inputSchema: { path: z.string().describe("Full dotted instance path to the script") },
    },
    async ({ path }) => runStudio("getScriptSource", { path }, (r) => r.source ?? "(empty)"),
  );

  server.registerTool(
    "set_script_source",
    {
      description: "Overwrite the Source of a script at the given path. Creates nothing — the script must exist.",
      inputSchema: {
        path: z.string().describe("Full dotted instance path to the script"),
        source: z.string().describe("New Luau source"),
      },
    },
    async ({ path, source }) => runStudio("setScriptSource", { path, source }, () => `Updated ${path}`),
  );

  server.registerTool(
    "grep_scripts",
    {
      description: "Search the Source of all scripts in the place for a Lua pattern. Returns matching path + line.",
      inputSchema: {
        pattern: z.string().describe("Lua string pattern to search for"),
        ignoreCase: z.boolean().optional(),
      },
    },
    async ({ pattern, ignoreCase }) =>
      runStudio("grepScripts", { pattern, ignoreCase: ignoreCase ?? false }, (r) =>
        Array.isArray(r?.matches) && r.matches.length
          ? r.matches.map((m: any) => `${m.path}:${m.line}: ${m.text}`).join("\n")
          : "(no matches)",
      ),
  );

  server.registerTool(
    "get_script_tree",
    {
      description: "List every script instance in the place with its class and path.",
      inputSchema: {},
    },
    async () =>
      runStudio("getScriptTree", {}, (r) =>
        Array.isArray(r?.scripts) ? r.scripts.map((s: any) => `${s.className}  ${s.path}`).join("\n") : "(none)",
      ),
  );
}
