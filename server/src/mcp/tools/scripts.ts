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

  server.registerTool(
    "edit_script_lines",
    {
      description:
        "Replace a line range in a script (1-indexed, inclusive) with newText — instead of re-sending the whole Source. Get line numbers from get_script_source/grep_scripts first. newText may be multi-line or empty (empties the range).",
      inputSchema: {
        path: z.string(),
        startLine: z.number().describe("first line to replace (1-indexed)"),
        endLine: z.number().describe("last line to replace (inclusive)"),
        newText: z.string().describe("replacement text (multi-line ok; '' deletes the range)"),
        place: placeArg,
      },
    },
    async ({ path, startLine, endLine, newText, place }) =>
      runStudio("editScriptLines", { path, startLine, endLine, newText }, (r) => `Edited ${path} (now ${r.lineCount} lines)`, place),
  );

  server.registerTool(
    "insert_script_lines",
    {
      description: "Insert newText AFTER the given line (afterLine = 0 inserts at the very top). Doesn't touch existing lines.",
      inputSchema: { path: z.string(), afterLine: z.number().describe("insert after this line (0 = beginning)"), newText: z.string(), place: placeArg },
    },
    async ({ path, afterLine, newText, place }) =>
      // insert before (afterLine+1): empty range [afterLine+1 .. afterLine]
      runStudio("editScriptLines", { path, startLine: afterLine + 1, endLine: afterLine, newText }, (r) => `Inserted into ${path} (now ${r.lineCount} lines)`, place),
  );

  server.registerTool(
    "delete_script_lines",
    {
      description: "Delete a range of lines (1-indexed, inclusive) from a script.",
      inputSchema: { path: z.string(), startLine: z.number(), endLine: z.number(), place: placeArg },
    },
    async ({ path, startLine, endLine, place }) =>
      runStudio("editScriptLines", { path, startLine, endLine, newText: "" }, (r) => `Deleted lines ${startLine}-${endLine} from ${path} (now ${r.lineCount} lines)`, place),
  );

  server.registerTool(
    "find_and_replace_in_scripts",
    {
      description: "Project-wide plain-text find & replace across all scripts. Set dryRun=true first to preview which scripts + how many hits before applying.",
      inputSchema: {
        find: z.string().describe("Plain text to find (not a pattern)"),
        replace: z.string().describe("Replacement text"),
        dryRun: z.boolean().optional().describe("Preview only; don't modify (default false)"),
        place: placeArg,
      },
    },
    async ({ find, replace, dryRun, place }) =>
      runStudio("findAndReplace", { find, replace, dryRun: dryRun ?? false }, (r) => {
        const edits = r?.edits ?? [];
        const head = `${r?.dryRun ? "[dry run] " : ""}${edits.length} script(s)${r?.dryRun ? " would be" : ""} changed`;
        if (!edits.length) return head;
        return head + ":\n" + edits.map((e: any) => `  ${e.path} (${e.count}×)`).join("\n");
      }, place),
  );
}
