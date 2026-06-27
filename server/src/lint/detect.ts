// Locate the optional Luau toolchain binaries used by the lint/format tools.
// Resolution order: TUFAN_<TOOL>_PATH env → the tool name on PATH. Result is
// cached per-process (mirrors blender/detect.ts). These are host-side dev tools,
// not runtime deps — the tools that use them degrade with a clear setup error
// when the binary is absent.

import { execFile } from "node:child_process";

export const STYLUA_HELP =
  "format_scripts needs StyLua installed (the standard Roblox/Luau formatter):\n" +
  "  github.com/JohnnyMorganz/StyLua/releases  ·  `cargo install stylua`  ·  `rokit add JohnnyMorganz/StyLua`\n" +
  "It's auto-detected on PATH; if it lives elsewhere set TUFAN_STYLUA_PATH=<full path to stylua(.exe)> in the tufan MCP server env.";

export const SELENE_HELP =
  "lint_scripts needs Selene installed (the standard Roblox/Luau linter):\n" +
  "  github.com/Kampfkarren/selene/releases  ·  `cargo install selene`  ·  `rokit add Kampfkarren/selene`\n" +
  "Auto-detected on PATH; set TUFAN_SELENE_PATH if it lives elsewhere. For accurate Roblox globals the\n" +
  'project needs a selene.toml with `std = "roblox"` (run `selene generate-roblox-std` once).';

export type BinInfo = { path: string; version: string };

function versionOf(exe: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(exe, ["--version"], { timeout: 8_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /(\d+\.\d+\.\d+)/.exec(stdout ?? "");
      resolve(m ? m[1] : (stdout ?? "").trim() || "unknown");
    });
  });
}

function makeResolver(envVar: string, binName: string, help: string) {
  let cached: BinInfo | { error: string } | null = null;
  async function resolve(): Promise<BinInfo | { error: string }> {
    if (cached) return cached;
    const candidates: string[] = [];
    const envPath = process.env[envVar]?.trim();
    if (envPath) candidates.push(envPath);
    candidates.push(binName); // PATH fallback
    for (const exe of candidates) {
      const v = await versionOf(exe);
      if (v) {
        cached = { path: exe, version: v };
        return cached;
      }
    }
    cached = { error: help };
    return cached;
  }
  resolve.reset = () => {
    cached = null;
  };
  return resolve;
}

export const resolveStylua = makeResolver("TUFAN_STYLUA_PATH", "stylua", STYLUA_HELP);
export const resolveSelene = makeResolver("TUFAN_SELENE_PATH", "selene", SELENE_HELP);
