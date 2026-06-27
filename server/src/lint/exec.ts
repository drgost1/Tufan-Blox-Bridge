// Shared host-side process-exec + path helpers for the Luau toolchain tools
// (format_scripts, lint_scripts, typecheck) — they run external binaries over a
// connected place's on-disk script mirror.

import { z } from "zod";
import { execFile } from "node:child_process";
import { isAbsolute, join, relative, sep } from "node:path";

export type Exec = { code: number; stdout: string; stderr: string; fail?: "enoent" | "timeout" | "buffer" | "other" };

// code -1 = the process never produced a clean exit; `fail` says why.
export function run(exe: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<Exec> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err: any, stdout, stderr) => {
        if (err && typeof err.code !== "number") {
          const codeStr = String(err.code ?? "");
          const fail: Exec["fail"] =
            codeStr === "ENOENT"
              ? "enoent"
              : err.killed || err.signal
                ? "timeout"
                : codeStr === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                  ? "buffer"
                  : "other";
          resolve({ code: -1, stdout: stdout ?? "", stderr: (stderr ?? "") + (err.message ?? ""), fail });
        } else {
          resolve({ code: err ? Number(err.code) : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
        }
      },
    );
  });
}

export function failMsg(res: Exec, help: string): string {
  if (res.fail === "timeout") return `timed out — raise timeoutSeconds or narrow with paths.\n${res.stderr.trim()}`;
  if (res.fail === "buffer") return `output too large (buffer exceeded) — narrow with paths.\n${res.stderr.trim()}`;
  if (res.fail === "enoent") return help;
  return `failed to run: ${res.stderr.trim()}\n${help}`;
}

// seconds -> ms, clamped to [1, 600].
export const ms = (s?: number) => Math.min(Math.max(s ?? 120, 1), 600) * 1000;

export const timeoutArg = z.number().optional().describe("max seconds for the run (default 120, max 600)");

// Resolve user paths against the mirror root and REJECT anything that escapes it.
export function targetsIn(root: string, paths?: string[]): { targets?: string[]; error?: string } {
  if (!paths || paths.length === 0) return { targets: [root] };
  const out: string[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : join(root, p);
    const rel = relative(root, abs);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      return { error: `path escapes the script-mirror root, refusing: ${p}` };
    }
    out.push(abs);
  }
  return { targets: out };
}
