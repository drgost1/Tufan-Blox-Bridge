import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerScriptTools(server: McpServer) {
  server.registerTool(
    "get_script_source",
    {
      description: "Read the Source of a Script/LocalScript/ModuleScript by full path, e.g. 'ServerScriptService.MusicService'.",
      inputSchema: { path: z.string().describe("Full dotted instance path"), place: placeArg },
    },
    async ({ path, place }) => runStudio("getScriptSource", { path }, (r) => r.source ?? "(empty)", place),
  );

  server.registerTool(
    "set_script_source",
    {
      description: "Overwrite the Source of an existing script at the given path.",
      inputSchema: { path: z.string(), source: z.string(), place: placeArg },
    },
    async ({ path, source, place }) => runStudio("setScriptSource", { path, source }, () => `Updated ${path}`, place),
  );

  server.registerTool(
    "grep_scripts",
    {
      description: "Search the Source of all scripts for a Lua pattern. Returns path:line: text.",
      inputSchema: { pattern: z.string(), ignoreCase: z.boolean().optional(), place: placeArg },
    },
    async ({ pattern, ignoreCase, place }) =>
      runStudio("grepScripts", { pattern, ignoreCase: ignoreCase ?? false }, (r) =>
        Array.isArray(r?.matches) && r.matches.length
          ? r.matches.map((m: any) => `${m.path}:${m.line}: ${m.text}`).join("\n")
          : "(no matches)",
        place,
      ),
  );

  server.registerTool(
    "get_script_tree",
    { description: "List every script instance with its class and path.", inputSchema: { place: placeArg } },
    async ({ place }) =>
      runStudio("getScriptTree", {}, (r) =>
        Array.isArray(r?.scripts) ? r.scripts.map((s: any) => `${s.className}  ${s.path}`).join("\n") : "(none)",
        place,
      ),
  );
}
