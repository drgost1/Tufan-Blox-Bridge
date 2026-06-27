import { z } from "zod";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { resolveTargetPlace, getSessionByPlace } from "../../bridge/sessions.js";
import { resolveLuauLsp, LUAU_LSP_HELP } from "../../lint/detect.js";
import { run, failMsg, ms, targetsIn, timeoutArg } from "../../lint/exec.js";
import { buildSourcemap } from "../../sourcemap/build.js";

// Static type-checking via `luau-lsp analyze`. Read-only host-side tool: runs the
// analyzer over a place's on-disk script mirror, resolving requires via a
// sourcemap and Roblox globals via type defs. No Studio round-trip, no mutation.

const CACHE_DIR = join(homedir(), ".tufan-blox-bridge", "luau-lsp");
// Cloudflare CDN (avoids GitHub rate-limiting); "None" security level = exactly
// what in-game scripts can access (verified against the luau-lsp editors README).
const DEFS_URL = "https://luau-lsp.pages.dev/type-definitions/globalTypes.None.d.luau";

function mirrorFor(place?: string | number): { root?: string; name?: string; placeId?: number; error?: string } {
  const t = resolveTargetPlace(place);
  if (t.error) return { error: t.error };
  const s = getSessionByPlace(t.placeId!);
  if (!s) return { error: `Place ${t.placeId} not connected.` };
  return { root: s.mirrorRoot ?? s.root, name: s.placeName, placeId: t.placeId };
}

// Roblox API type defs: env override -> a project-local globalTypes*.d.luau
// (searched up the tree) -> a cached download from the luau-lsp CDN. Without defs
// luau-lsp still runs, but every Roblox global reports as unknown.
function findProjectDefs(root: string): string | null {
  let dir = root;
  for (let i = 0; i < 5; i++) {
    try {
      const hit = readdirSync(dir).find((f) => /^globalTypes.*\.d\.luau?$/.test(f));
      if (hit) return join(dir, hit);
    } catch {
      /* skip unreadable dir */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function resolveDefs(root: string): Promise<{ path?: string; note?: string }> {
  const env = process.env.TUFAN_LUAU_DEFS?.trim();
  if (env && existsSync(env)) return { path: env };
  const envNote = env ? `TUFAN_LUAU_DEFS points at a missing file (${env}); falling back. ` : "";

  const proj = findProjectDefs(root);
  if (proj) return { path: proj, note: envNote || undefined };

  const cache = join(CACHE_DIR, "globalTypes.None.d.luau");
  if (existsSync(cache)) return { path: cache, note: envNote || undefined };

  // One-time fetch to the cache. `fetch` is a Node 18+ global; the catch also
  // covers it being undefined on an older runtime — we just degrade to no defs.
  try {
    const res = await fetch(DEFS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cache, body, "utf8");
    return { path: cache, note: envNote + "fetched Roblox type defs (globalTypes.None) to the cache" };
  } catch (e) {
    return {
      note:
        envNote +
        `no Roblox type defs (download failed: ${(e as Error).message}). Roblox globals will report as ` +
        `unknown — set TUFAN_LUAU_DEFS or add a globalTypes.d.luau to the project.`,
    };
  }
}

// Use an existing sourcemap.json in the mirror, else synthesize one from the disk
// mirror (same logic as export_sourcemap) into the cache so requires resolve.
// Per-place temp filename so concurrent places don't clobber each other's map.
function resolveSourcemap(root: string, name: string, placeId?: number): { path?: string; error?: string } {
  const existing = join(root, "sourcemap.json");
  if (existsSync(existing)) return { path: existing };
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = join(CACHE_DIR, `sourcemap-${placeId ?? "default"}.json`);
    writeFileSync(tmp, JSON.stringify(buildSourcemap(root, name || "game")), "utf8");
    return { path: tmp };
  } catch (e) {
    return { error: `sourcemap build failed: ${(e as Error).message}` };
  }
}

export function registerTypecheckTools(server: McpServer) {
  // Read-only: reports type errors, changes nothing in the place. (It caches a
  // sourcemap/defs under ~/.tufan-blox-bridge, not user data — stays visible in
  // read-only mode.)
  server.registerTool(
    "typecheck",
    {
      description:
        "Type-check Luau with luau-lsp (the Luau analyzer) over a place's synced script mirror — catches " +
        "type errors, undefined globals, and bad require paths BEFORE the code runs. Read-only: reports " +
        "findings, changes nothing. Resolves requires via a sourcemap (uses sourcemap.json if present, else " +
        "synthesizes one) and Roblox globals via type defs (TUFAN_LUAU_DEFS, a project globalTypes.d.luau, " +
        "or an auto-cached download). Scope with `paths` or check the whole mirror. Needs luau-lsp installed " +
        "(auto-detected or TUFAN_LUAU_LSP_PATH).",
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
      const lsp = await resolveLuauLsp();
      if ("error" in lsp) return errorText(lsp.error);
      const m = mirrorFor(place);
      if (m.error) return errorText(m.error);
      const t = targetsIn(m.root!, paths);
      if (t.error) return errorText(t.error);

      const defs = await resolveDefs(m.root!);
      const sm = resolveSourcemap(m.root!, m.name || "game", m.placeId);
      if (sm.error) return errorText(sm.error);

      // Verified canonical invocation (luau-lsp analyze): roblox platform, relaxed
      // DM types to avoid false positives, sourcemap for requires, defs for globals.
      const args = ["analyze", "--platform", "roblox", "--no-strict-dm-types", "--sourcemap", sm.path!];
      if (defs.path) args.push("--defs", defs.path);
      args.push("--ignore", "**/Packages/**", "--ignore", "**/_Index/**", "--ignore", "**/node_modules/**");
      args.push(...t.targets!);

      const res = await run(lsp.path, args, m.root!, ms(timeoutSeconds));
      if (res.code === -1) return errorText(failMsg(res, LUAU_LSP_HELP));

      // Default formatter writes findings to STDERR as `file(line,col): TypeError: msg`.
      // Exit 0 = clean; 1 = problems found OR a bad invocation — tell them apart by
      // whether the output has finding-shaped `(line,col):` lines.
      const report = (res.stderr.trim() || res.stdout.trim()).trim();
      const prefix = defs.note ? `(${defs.note})\n\n` : "";
      if (res.code === 0) return text(`${prefix}✓ no type errors (luau-lsp ${lsp.version} clean)`);
      if (/\(\d+,\d+\):/.test(report)) return text(prefix + report);
      return errorText(`luau-lsp error (exit ${res.code}):\n${report || "(no output)"}\n\n${LUAU_LSP_HELP}`);
    },
  );
}
