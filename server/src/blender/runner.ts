// Headless Blender subprocess runner. Mirrors the capture.ts execFile pattern:
// args ARRAY (never a shell string — "Program Files" spaces), windowsHide,
// generous maxBuffer, hard timeout.
//
// Result protocol (the Blender-side analogue of spatial.ts's resultJson
// contract): the wrapper runs the script body inside try/except —
//   success → the body prints  @@TUFAN_RESULT@@<json>   (canned ops always do)
//   Python error → wrapper prints @@TUFAN_ERROR@@<json-encoded traceback>, exit 1
// The runner parses the LAST sentinel line. Non-zero exit with NO sentinel =
// Blender crashed natively (no Python error) — reported distinctly.

import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RESULT_SENTINEL = "@@TUFAN_RESULT@@";
export const ERROR_SENTINEL = "@@TUFAN_ERROR@@";

export type BlenderRun = {
  ok: boolean;
  /** Parsed JSON payload from the last @@TUFAN_RESULT@@ line (if any). */
  result?: any;
  /** Python traceback (real newlines) when the script raised. */
  pythonError?: string;
  /** Non-sentinel failure description (timeout, native crash, spawn error). */
  error?: string;
  stdoutTail: string;
  stderrTail: string;
  exitCode: number | null;
};

const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);

/** Escape a path for embedding in a Python raw string literal. */
function pyPath(p: string): string {
  // r"..." can't end in a backslash and can't contain the quote — JSON-encode
  // instead, which Python accepts as a regular string literal with escapes.
  return JSON.stringify(p);
}

export async function runBlender(opts: {
  blenderPath: string;
  /** The bpy script body (canned template or user script). */
  script: string;
  /** k=v args surfaced to the script via sys.argv after `--`. */
  args?: Record<string, string | number | boolean>;
  timeoutMs?: number;
  /** Default true. Fracture needs false so user extensions (Cell Fracture) load. */
  factoryStartup?: boolean;
}): Promise<BlenderRun> {
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 180_000, 10_000), 600_000);
  const dir = await mkdtemp(join(tmpdir(), "tufan-blender-"));
  const bodyPath = join(dir, "body.py");
  const wrapperPath = join(dir, "wrapper.py");

  const wrapper = [
    "import sys, json, traceback",
    "try:",
    `    with open(${pyPath(bodyPath)}, "r", encoding="utf-8") as _f:`,
    "        _src = _f.read()",
    `    exec(compile(_src, ${pyPath(bodyPath)}, "exec"), {"__name__": "__main__"})`,
    "except SystemExit:",
    "    raise",
    "except BaseException:",
    `    print(${JSON.stringify(ERROR_SENTINEL)} + json.dumps(traceback.format_exc()))`,
    "    sys.exit(1)",
    "",
  ].join("\n");

  const kv = Object.entries(opts.args ?? {}).map(([k, v]) => `${k}=${String(v)}`);
  const blenderArgs = [
    "-b",
    ...(opts.factoryStartup === false ? [] : ["--factory-startup"]),
    "-P",
    wrapperPath,
    "--",
    ...kv,
  ];

  try {
    await writeFile(bodyPath, opts.script, "utf8");
    await writeFile(wrapperPath, wrapper, "utf8");

    const { stdout, stderr, exitCode, spawnError, timedOut } = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
      spawnError?: string;
      timedOut: boolean;
    }>((resolve) => {
      execFile(
        opts.blenderPath,
        blenderArgs,
        { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: timeoutMs },
        (err: any, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: err ? (typeof err.code === "number" ? err.code : null) : 0,
            spawnError: err && err.code === "ENOENT" ? `Blender not runnable at ${opts.blenderPath}` : undefined,
            timedOut: Boolean(err?.killed && err?.signal === "SIGTERM"),
          });
        },
      );
    });

    if (spawnError) {
      return { ok: false, error: spawnError, stdoutTail: "", stderrTail: "", exitCode: null };
    }

    // Last sentinel line wins (a script may log noise between sentinels).
    let result: any;
    let pythonError: string | undefined;
    for (const line of stdout.split(/\r?\n/)) {
      const r = line.indexOf(RESULT_SENTINEL);
      if (r >= 0) {
        try {
          result = JSON.parse(line.slice(r + RESULT_SENTINEL.length));
          pythonError = undefined;
        } catch {
          /* malformed sentinel — keep previous */
        }
        continue;
      }
      const e = line.indexOf(ERROR_SENTINEL);
      if (e >= 0) {
        try {
          pythonError = JSON.parse(line.slice(e + ERROR_SENTINEL.length));
        } catch {
          pythonError = line.slice(e + ERROR_SENTINEL.length);
        }
      }
    }

    if (timedOut) {
      return {
        ok: false,
        error: `Blender timed out after ${Math.round(timeoutMs / 1000)}s (raise timeoutSeconds for heavy meshes)`,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
        exitCode,
      };
    }
    if (pythonError) {
      return { ok: false, pythonError, stdoutTail: tail(stdout), stderrTail: tail(stderr), exitCode };
    }
    if (exitCode !== 0) {
      return {
        ok: false,
        error: `Blender crashed natively (exit ${exitCode}, no Python traceback) — possibly a corrupt input file or a Blender bug`,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
        exitCode,
      };
    }
    return { ok: true, result, stdoutTail: tail(stdout), stderrTail: tail(stderr), exitCode };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
