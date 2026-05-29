import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, requireWritable, text, errorText } from "../helpers.js";
import { createHash } from "node:crypto";
import { dispatchTo, resolveTargetPlace } from "../../bridge/sessions.js";

export function registerScriptTools(server: McpServer) {
  server.registerTool(
    "script_source",
    {
      description:
        "Read OR write a script's Source. Omit `source` to READ the Source of a " +
        "Script/LocalScript/ModuleScript by full path (e.g. 'ServerScriptService.MusicService'); " +
        "pass `source` to OVERWRITE the whole Source. (Replaces get_script_source + set_script_source.)",
      inputSchema: {
        path: z.string().describe("Full dotted instance path"),
        source: z.string().optional().describe("omit to read; provide to overwrite the whole Source"),
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

  // get_script_tree killed → use search_objects(className="LuaSourceContainer").

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

  // insert_script_lines / delete_script_lines killed → edit_script_lines does both
  // (insert = empty range endLine=startLine-1; delete = newText=""). patch_script
  // is the anchored multi-hunk option that doesn't need line numbers.

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

  server.registerTool(
    "patch_script",
    {
      description:
        "Apply MANY anchored find/replace hunks to ONE script in one call — refactor-grade editing without resending the whole file. Each hunk is a LITERAL match (not a pattern), applied in order. ATOMIC: if a required hunk's `find` isn't present it errors and writes NOTHING (so a stale patch can't half-apply or silently no-op). Mark a hunk optional to skip it when absent. Set dryRun to validate the patch applies cleanly without writing.",
      inputSchema: {
        path: z.string(),
        hunks: z
          .array(
            z.object({
              find: z.string().describe("literal text to find"),
              replace: z.string().describe("replacement text"),
              all: z.boolean().optional().describe("replace every occurrence (default: first only)"),
              optional: z.boolean().optional().describe("skip instead of erroring if `find` is absent"),
            }),
          )
          .describe("ordered hunks"),
        dryRun: z.boolean().optional().describe("validate only; don't write"),
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
        "Find scripts with IDENTICAL Source — copy-pasted code ripe for extracting into a shared " +
        "ModuleScript. Hashes every script's Source and reports each cluster of 2+ exact matches, " +
        "biggest first. Read-only.",
      inputSchema: {
        minLines: z.number().optional().describe("ignore scripts shorter than this many lines (default 3) — skips trivial stubs"),
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
