// History — frozen copies of mirror files, so something removed or undone in
// Studio can still be brought back after the live mirror has moved on.
//
// Layout (inside a place mirror):
//   .history/<stamp>/<same relative path as in the mirror>
//   .history/index.jsonl   one line per copy: { t, stamp, rel, studioPath, kind, reason, bytes }
//
// A copy is taken BEFORE a mirror file is deleted or overwritten:
//   removed        the instance/script is gone from Studio      -> always (unless identical to the newest copy)
//   child-removed  a unit lost descendants (delete, Ctrl+Z)     -> unless a copy was made < 30 s ago
//   edit / pull    plain overwrite                              -> at most one copy per file every 5 min
// Copies older than RETENTION_DAYS are pruned when a place connects.

import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../util/log.js";

export const HISTORY_DIR = ".history";
const INDEX_FILE = "index.jsonl";
const RETENTION_DAYS = 30;
const EDIT_GAP_MS = 5 * 60_000;
const CHILD_REMOVED_GAP_MS = 30_000;

export type HistoryKind = "instance" | "script";
export type HistoryReason = "removed" | "child-removed" | "edit" | "pull" | "missing-at-connect";

export interface HistoryEntry {
  t: number; // ms since epoch
  stamp: string;
  rel: string; // path relative to the mirror root (forward slashes)
  studioPath: string;
  kind: HistoryKind;
  reason: HistoryReason;
  bytes: number;
}

// Windows long-path prefix (deep Studio trees pass 260 chars).
export function longPath(p: string): string {
  if (process.platform !== "win32") return p;
  const native = p.replace(/\//g, "\\");
  return native.startsWith("\\\\?\\") ? native : "\\\\?\\" + native;
}

/** Make an existing file writable (the mirror is chmod'ed read-only while the
 *  plugin is disconnected, and the unlock walk may still be running). */
export function ensureWritable(absPath: string): void {
  try {
    if (existsSync(longPath(absPath))) chmodSync(longPath(absPath), 0o644);
  } catch {
    /* best-effort */
  }
}

function stampNow(d = new Date()): string {
  // 2026-11-11T14-03-22-123Z: sortable, filesystem-safe
  return d.toISOString().replace(/[:.]/g, "-");
}

function stampToMs(stamp: string): number {
  const m = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
}

const lastCopy = new Map<string, { t: number; hash: string }>(); // `${root}|${rel}`

function sha1(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

/** Copy the CURRENT mirror file at `rel` into .history before it's replaced or
 *  deleted. `incoming` (the bytes about to be written) skips the copy when
 *  nothing would change. Returns the stamp used, or null when skipped. */
export function preserve(
  root: string,
  rel: string,
  studioPath: string,
  kind: HistoryKind,
  reason: HistoryReason,
  incoming?: Buffer | string,
): string | null {
  const relFwd = rel.replace(/\\/g, "/");
  const abs = join(root, relFwd);
  const lp = longPath(abs);
  if (!existsSync(lp)) return null;
  let current: Buffer;
  try {
    current = readFileSync(lp);
  } catch {
    return null;
  }
  if (incoming !== undefined) {
    const next = typeof incoming === "string" ? Buffer.from(incoming, "utf8") : incoming;
    if (next.equals(current)) return null; // overwrite with identical bytes
  }
  const hash = sha1(current);
  const key = `${root}|${relFwd}`;
  const last = lastCopy.get(key);
  const now = Date.now();
  if (last && last.hash === hash) return null; // already frozen
  if (last && reason === "child-removed" && now - last.t < CHILD_REMOVED_GAP_MS) return null;
  if (last && (reason === "edit" || reason === "pull") && now - last.t < EDIT_GAP_MS) return null;

  const stamp = stampNow(new Date(now));
  const dest = join(root, HISTORY_DIR, stamp, relFwd);
  try {
    mkdirSync(dirname(longPath(dest)), { recursive: true });
    copyFileSync(lp, longPath(dest));
    ensureWritable(dest); // the source may have been read-only
    const entry: HistoryEntry = { t: now, stamp, rel: relFwd, studioPath, kind, reason, bytes: current.length };
    const index = join(root, HISTORY_DIR, INDEX_FILE);
    ensureWritable(index); // may still be read-only while the reconnect unlock walk runs
    appendFileSync(longPath(index), JSON.stringify(entry) + "\n", "utf8");
    lastCopy.set(key, { t: now, hash });
    return stamp;
  } catch (e) {
    log(`history copy failed for ${relFwd}: ${(e as Error).message}`);
    return null;
  }
}

export function readHistory(root: string): HistoryEntry[] {
  const p = longPath(join(root, HISTORY_DIR, INDEX_FILE));
  if (!existsSync(p)) return [];
  const out: HistoryEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as HistoryEntry;
      if (existsSync(longPath(join(root, HISTORY_DIR, e.stamp, e.rel)))) out.push(e);
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}

export function historyFile(root: string, e: HistoryEntry): string {
  return join(root, HISTORY_DIR, e.stamp, e.rel);
}

/** Drop copies older than RETENTION_DAYS and keep .history out of the mirror's
 *  own git repo (if the user turned git on). Called on connect. */
export function maintainHistory(root: string): void {
  try {
    const gi = join(root, ".gitignore");
    const line = `${HISTORY_DIR}/`;
    const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
    if (!cur.split(/\r?\n/).includes(line)) {
      ensureWritable(gi);
      writeFileSync(gi, (cur && !cur.endsWith("\n") ? cur + "\n" : cur) + line + "\n", "utf8");
    }
  } catch {
    /* best-effort */
  }

  const dir = longPath(join(root, HISTORY_DIR));
  if (!existsSync(dir)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const ms = stampToMs(name);
    if (Number.isFinite(ms) && ms < cutoff) {
      try {
        rmSync(join(dir, name), { recursive: true, force: true });
        removed++;
      } catch {
        /* best-effort */
      }
    }
  }
  if (removed > 0) {
    const kept = readHistory(root);
    const idx = longPath(join(root, HISTORY_DIR, INDEX_FILE));
    ensureWritable(idx);
    writeFileSync(idx, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""), "utf8");
    log(`history: pruned ${removed} copies older than ${RETENTION_DAYS} days in ${root}`);
  }
}
