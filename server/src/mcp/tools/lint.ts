import { z } from "zod";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, requireWritable, placeArg } from "../helpers.js";
import { resolveTargetPlace, getSessionByPlace } from "../../bridge/sessions.js";
import { resolveStylua, resolveSelene, STYLUA_HELP, SELENE_HELP } from "../../lint/detect.js";
import { run, failMsg, ms, targetsIn, timeoutArg } from "../../lint/exec.js";

// Host-side Luau quality tools — they run the standard external binaries (StyLua,
// Selene) over a connected place's on-disk script mirror. No plugin involvement;
// PluginSecurity is irrelevant. Same shell-out posture as the Blender/git tools.

// Resolve the on-disk script-mirror root for a place (same as the git tools).
function rootFor(place?: string | number): { root?: string; error?: string } {
  const t = resolveTargetPlace(place);
  if (t.error) return { error: t.error };
  const s = getSessionByPlace(t.placeId!);
  if (!s) return { error: `Place ${t.placeId} not connected.` };
  return { root: s.mirrorRoot ?? s.root };
}

// selene/stylua look for their config in the cwd and ancestors — mirror that so we
// can warn UP FRONT instead of flooding false undefined-global findings.
function hasConfig(start: string, names: string[]): boolean {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    if (names.some((n) => existsSync(join(dir, n)))) return true;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

export function registerLintTools(server: McpServer) {
  // Mixed read/write: `check:true` is a read (visible in read-only mode); the
  // default write path is gated at call time via requireWritable().
  server.registerTool(
    "format_scripts",
    {
      description:
        "Format Luau on disk with StyLua (the standard Roblox formatter) over a place's synced script " +
        "mirror. Default formats in place; `check:true` reports what's NOT formatted WITHOUT writing " +
        "(a --check diff) — use it as a pre-commit gate so git diffs and snapshots stay clean. Respects " +
        "a .stylua.toml in the project. Scope with `paths` (relative to the mirror root) or format the " +
        "whole mirror. Needs StyLua installed (auto-detected or TUFAN_STYLUA_PATH).",
      inputSchema: {
        paths: z
          .array(z.string())
          .optional()
          .describe("files/dirs relative to the script-mirror root (default: the whole mirror)"),
        check: z.boolean().optional().describe("don't write — just report unformatted files (default false)"),
        timeoutSeconds: timeoutArg,
        place: placeArg,
      },
    },
    async ({ paths, check, timeoutSeconds, place }) => {
      if (!check) {
        const ro = requireWritable();
        if (ro) return ro;
      }
      const sty = await resolveStylua();
      if ("error" in sty) return errorText(sty.error);
      const r = rootFor(place);
      if (r.error) return errorText(r.error);
      const t = targetsIn(r.root!, paths);
      if (t.error) return errorText(t.error);

      const args = check ? ["--check", ...t.targets!] : [...t.targets!];
      const res = await run(sty.path, args, r.root!, ms(timeoutSeconds));

      if (res.code === -1) return errorText(failMsg(res, STYLUA_HELP));
      if (check) {
        if (res.code === 0) return text("✓ all targets already formatted (StyLua clean)");
        // diff goes to stdout; a real parse/IO error goes to stderr with empty stdout
        if (res.stdout.trim()) return text(`✗ formatting differences found:\n${res.stdout}`);
        return errorText(`stylua --check error:\n${res.stderr.trim()}\n${STYLUA_HELP}`);
      }
      if (res.code !== 0) return errorText(`stylua error:\n${res.stderr || res.stdout}`);
      const scope = paths && paths.length ? paths.join(", ") : "the whole mirror";
      return text(`✓ formatted ${scope} with StyLua ${sty.version}`);
    },
  );

  // Read-only: reports lint findings, changes nothing.
  server.registerTool(
    "lint_scripts",
    {
      description:
        "Lint Luau with Selene (the standard Roblox linter) over a place's synced script mirror — catches " +
        "footguns, unused variables, shadowing, undefined globals, and deprecated APIs (file:line). " +
        "Read-only: reports findings, changes nothing. Scope with `paths` or lint the whole mirror. Needs " +
        'Selene installed (auto-detected or TUFAN_SELENE_PATH) and a selene.toml with std="roblox" in the ' +
        "project (else Roblox globals report as undefined).",
      inputSchema: {
        paths: z
          .array(z.string())
          .optional()
          .describe("files/dirs relative to the script-mirror root (default: the whole mirror)"),
        timeoutSeconds: timeoutArg,
        place: placeArg,
      },
    },
    async ({ paths, timeoutSeconds, place }) => {
      const sel = await resolveSelene();
      if ("error" in sel) return errorText(sel.error);
      const r = rootFor(place);
      if (r.error) return errorText(r.error);
      const t = targetsIn(r.root!, paths);
      if (t.error) return errorText(t.error);

      // Without a selene config the run floods false "undefined variable" findings
      // for every Roblox global — refuse up front with the setup hint instead.
      if (!hasConfig(r.root!, ["selene.toml", "selene.yml"])) {
        return errorText(
          `No selene.toml found near the script mirror (${r.root}). Selene needs one with std="roblox" ` +
            `to recognize Roblox globals; without it every game/workspace/script reports as undefined.\n\n${SELENE_HELP}`,
        );
      }

      // quiet display = compact `file:line:col: severity[code] message`, no ANSI — AI-friendly.
      const res = await run(sel.path, ["--display-style", "quiet", ...t.targets!], r.root!, ms(timeoutSeconds));
      if (res.code === -1) return errorText(failMsg(res, SELENE_HELP));
      // Findings go to stdout; a fatal config/parse error goes to stderr with empty stdout.
      // (Don't rely on a specific non-zero code — selene uses 1 for both lints and some errors.)
      if (res.code !== 0 && !res.stdout.trim()) {
        return errorText(`selene error:\n${res.stderr.trim()}\n\n${SELENE_HELP}`);
      }
      const out = `${res.stdout}${res.stderr ? "\n" + res.stderr : ""}`.trim();
      if (res.code === 0 && !out) return text(`✓ no lint findings (Selene ${sel.version} clean)`);
      return text(out || "(no output)");
    },
  );
}
