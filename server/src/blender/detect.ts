// Locate a usable Blender executable for headless processing.
// Resolution order: TUFAN_BLENDER_PATH env → newest install under the standard
// Windows/macOS locations → `blender` on PATH. Result is cached per-process.

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const BLENDER_HELP =
  "Blender tools need Blender installed (free, https://www.blender.org/download/ — 4.2+ recommended).\n" +
  "Auto-detect scans 'C:\\Program Files\\Blender Foundation\\Blender *' and PATH; if your install\n" +
  "lives elsewhere, set TUFAN_BLENDER_PATH=<full path to blender.exe> in the tufan MCP server env.";

export type BlenderInfo = { path: string; version: string };

let cached: BlenderInfo | { error: string } | null = null;

function versionOf(exe: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(exe, ["--version"], { timeout: 8_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      // First line looks like "Blender 5.1.0".
      const m = /Blender\s+(\d+\.\d+(?:\.\d+)?)/.exec(stdout ?? "");
      resolve(m ? m[1] : null);
    });
  });
}

async function candidates(): Promise<string[]> {
  const list: string[] = [];
  const envPath = process.env.TUFAN_BLENDER_PATH?.trim();
  if (envPath) list.push(envPath);

  if (process.platform === "win32") {
    const base = "C:\\Program Files\\Blender Foundation";
    try {
      const dirs = (await readdir(base, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && /^Blender\s/.test(d.name))
        .map((d) => d.name)
        // "Blender 5.1" → numeric sort, newest first
        .sort((a, b) => {
          const va = a.replace(/[^\d.]/g, "").split(".").map(Number);
          const vb = b.replace(/[^\d.]/g, "").split(".").map(Number);
          return (vb[0] ?? 0) - (va[0] ?? 0) || (vb[1] ?? 0) - (va[1] ?? 0);
        });
      for (const d of dirs) {
        const exe = join(base, d, "blender.exe");
        if (existsSync(exe)) list.push(exe);
      }
    } catch {
      // base dir absent — fall through to PATH
    }
  } else if (process.platform === "darwin") {
    list.push("/Applications/Blender.app/Contents/MacOS/Blender");
  }
  list.push("blender"); // PATH fallback (any platform)
  return list;
}

/** Find Blender; cached after the first successful (or failed) scan. */
export async function resolveBlender(): Promise<BlenderInfo | { error: string }> {
  if (cached) return cached;
  for (const exe of await candidates()) {
    const v = await versionOf(exe);
    if (v) {
      cached = { path: exe, version: v };
      return cached;
    }
  }
  cached = { error: `No working Blender found.\n${BLENDER_HELP}` };
  return cached;
}

/** Test hook — clear the per-process cache (e.g. after env changes). */
export function resetBlenderCache(): void {
  cached = null;
}
