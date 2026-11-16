import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, pathArg, requireWritable, text, errorText } from "../helpers.js";
import { createHash } from "node:crypto";
import { dispatchTo, resolveTargetPlace } from "../../bridge/sessions.js";

export function registerScriptTools(server: McpServer) {
  server.registerTool(
    "script_source",
    {
      description:
        "Read a script's full Source, or replace all of it. Reading is read-only; writing overwrites the whole script (open editor tabs update too) and is blocked in read-only mode. " +
        "For small changes prefer patch_script (anchored find/replace) or edit_script_lines (a line range), which don't resend the file. To search across scripts use grep_scripts.",
      inputSchema: {
        path: pathArg('Script, LocalScript or ModuleScript, e.g. "ServerScriptService.MusicService"'),
        source: z.string().optional().describe("New full Source. Omit to read the current Source instead."),
        place: placeArg,
      },
    },
    async ({ path, source, place }) => {
      if (source === undefined) {
        return runStudio("getScriptSource", { path }, (r) => r.source ?? "(empty)", place);
      }
      const blocked = requireWritable();
      if (blocked) return blocked;
      return runStudio("setScriptSource", { path, source }, () => `Updated ${path}`, place);
    },
  );

  server.registerTool(
    "grep_scripts",
    {
      description:
        "Search the Source of every script in the place and return matching lines as path:line: text. Read-only; stops at 500 matches. " +
        "Use it to find where something is defined or used before editing. To find instances by name use search_objects; to replace text everywhere use find_and_replace_in_scripts.",
      inputSchema: {
        pattern: z.string().describe('Lua pattern (not a regex): magic characters ( ) . % + - * ? [ ^ $ need a % escape, e.g. "game%.Players".'),
        ignoreCase: z.boolean().optional().describe("Match regardless of case. Default false."),
        place: placeArg,
      },
    },
    async ({ pattern, ignoreCase, place }) =>
      runStudio("grepScripts", { pattern, ignoreCase: ignoreCase ?? false }, (r) =>
        Array.isArray(r?.matches) && r.matches.length
          ? r.matches.map((m: any) => `${m.path}:${m.line}: ${m.text}`).join("\n")
          : "(no matches)",
        place,
      ),
  );

  // get_script_tree killed → use search_objects(className="LuaSourceContainer").

  server.registerTool(
    "edit_script_lines",
    {
      description:
        "Replace a range of lines in one script with new text, without resending the whole Source; returns the new line count. Overwrites those lines. " +
        "Line numbers shift after each edit, so re-read with script_source or grep_scripts before a second edit. When you can quote the text to change, patch_script is safer because it doesn't depend on line numbers.",
      inputSchema: {
        path: pathArg("Script to edit"),
        startLine: z.number().int().min(1).describe("First line to replace, counting from 1."),
        endLine: z.number().int().describe("Last line to replace, inclusive. Use startLine - 1 to insert before startLine without removing anything."),
        newText: z.string().describe('Replacement text; may span several lines. "" deletes the range.'),
        place: placeArg,
      },
    },
    async ({ path, startLine, endLine, newText, place }) =>
      runStudio("editScriptLines", { path, startLine, endLine, newText }, (r) => `Edited ${path} (now ${r.lineCount} lines)`, place),
  );

  // insert_script_lines / delete_script_lines killed → edit_script_lines does both
  // (insert = empty range endLine=startLine-1; delete = newText=""). patch_script
  // is the anchored multi-hunk option that doesn't need line numbers.

  server.registerTool(
    "find_and_replace_in_scripts",
    {
      description:
        "Replace a piece of plain text in every script of the place at once, for renames across the codebase. Overwrites every match in every script. " +
        "Run with dryRun true first to see which scripts and how many matches would change. For changes inside one script use patch_script.",
      inputSchema: {
        find: z.string().describe("Plain text to find (not a pattern)"),
        replace: z.string().describe("Replacement text"),
        dryRun: z.boolean().optional().describe("List what would change without writing anything. Default false."),
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

  server.registerTool(
    "patch_script",
    {
      description:
        "Apply several literal find-and-replace hunks to one script in a single call, in order, without resending the file. " +
        "All or nothing: if a required hunk's text is missing, it errors and writes nothing, so a stale patch can't half-apply. Use dryRun to check first. " +
        "The safest way to edit code you can quote; for a line range use edit_script_lines, and for the same change in many scripts use find_and_replace_in_scripts.",
      inputSchema: {
        path: pathArg("Script to patch"),
        hunks: z
          .array(
            z.object({
              find: z.string().describe("Exact text to find, including whitespace. Not a pattern."),
              replace: z.string().describe("Text to put in its place."),
              all: z.boolean().optional().describe("Replace every occurrence. Default false: only the first."),
              optional: z.boolean().optional().describe("Skip this hunk instead of failing the whole patch when find is absent. Default false."),
            }),
          )
          .describe("Hunks, applied in order; each sees the result of the previous ones."),
        dryRun: z.boolean().optional().describe("Check that every hunk applies, without writing. Default false."),
        place: placeArg,
      },
    },
    async ({ path, hunks, dryRun, place }) =>
      runStudio("patchScript", { path, hunks, dryRun: dryRun ?? false }, (r) => {
        const tag = r?.dryRun ? "[dry run] " : "";
        const detail = Array.isArray(r?.hunks)
          ? r.hunks.map((h: any, i: number) => `  [${i}] ${h.applied ? `applied ${h.count}×` : h.reason ?? "skipped"}`).join("\n")
          : "";
        return `${tag}patched ${path} — ${r?.replacements ?? 0} replacement(s)\n${detail}`;
      }, place),
  );

  server.registerTool(
    "find_duplicates",
    {
      description:
        "Find groups of scripts whose Source is exactly identical, biggest group first: copy-pasted code to move into one shared ModuleScript. Read-only. " +
        "Only exact copies match; near-duplicates with small edits are not reported. To search for a specific snippet use grep_scripts.",
      inputSchema: {
        minLines: z.number().int().min(1).optional().describe("Ignore scripts shorter than this many lines, to skip trivial stubs. Default 3."),
        place: placeArg,
      },
    },
    async ({ minLines, place }) => {
      const target = resolveTargetPlace(place);
      if (target.error) return errorText(target.error);
      try {
        const res: any = await dispatchTo(target.placeId!, "pullAll", {});
        const scripts: any[] = res?.scripts ?? [];
        const floor = minLines ?? 3;
        const byHash = new Map<string, { paths: string[]; lines: number }>();
        for (const s of scripts) {
          const src = String(s.source ?? "");
          if (src.trim() === "") continue;
          const lines = src.split("\n").length;
          if (lines < floor) continue;
          const h = createHash("sha1").update(src).digest("hex");
          const e = byHash.get(h) ?? { paths: [], lines };
          e.paths.push(s.studioPath);
          byHash.set(h, e);
        }
        const clusters = [...byHash.values()]
          .filter((e) => e.paths.length > 1)
          .sort((a, b) => b.paths.length - a.paths.length);
        if (!clusters.length) return text(`No duplicate scripts found (scanned ${scripts.length}, ≥${floor} lines).`);
        const redundant = clusters.reduce((n, c) => n + (c.paths.length - 1), 0);
        const body = clusters
          .map((c) => `× ${c.paths.length} identical (${c.lines} lines):\n` + c.paths.map((p) => `    ${p}`).join("\n"))
          .join("\n");
        return text(`${clusters.length} duplicate cluster(s), ${redundant} redundant copy(ies) — candidates for a shared module:\n${body}`);
      } catch (e) {
        return errorText(`find_duplicates failed: ${(e as Error).message}`);
      }
    },
  );
}
