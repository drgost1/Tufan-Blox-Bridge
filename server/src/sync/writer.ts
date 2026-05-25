// Writer — applies Studio-side script changes to the local files. Targets the
// per-place mirror (projects/<exp>/<place>/) when present; falls back to the
// legacy project.json mapping otherwise. Auto-commits/pushes per runtime config.

import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { Session } from "../bridge/sessions.js";
import { markServerWrite } from "./loopguard.js";
import { writeMirrorScriptLive, removeMirrorScript } from "./mirror.js";
import { autoCommit } from "../git/git.js";
import { runtimeConfig } from "../config.js";
import { log } from "../util/log.js";

export interface WriterOptions {
  autoCommitOnStudioEdit: boolean;
}

/** Write one script to the local files (no commit). Returns repoRoot + relPath. */
function writeOne(
  session: Session,
  studioPath: string,
  source: string,
  className?: string,
): { repoRoot: string; relPath: string } | null {
  let absPath: string | undefined;
  let repoRoot: string | undefined;

  if (session.mirrorRoot) {
    absPath = writeMirrorScriptLive(session.mirrorRoot, studioPath, className ?? "ModuleScript", source);
    repoRoot = session.mirrorRoot;
  } else if (session.project) {
    const p = session.project.fsPathFor(studioPath) ?? session.project.computeFsPath(studioPath, className);
    if (!p) return null;
    markServerWrite(p);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, source, "utf8");
    absPath = p;
    repoRoot = session.root;
  } else {
    return null;
  }
  return { repoRoot: repoRoot!, relPath: relative(repoRoot!, absPath) };
}

/** Remove one script's file(s) from the local files (no commit). Returns the
 *  repoRoot + every relPath removed (a folder-script can map to several). */
function removeOne(
  session: Session,
  studioPath: string,
): { repoRoot: string; relPaths: string[] } | null {
  if (session.mirrorRoot) {
    const relPaths = removeMirrorScript(session.mirrorRoot, studioPath);
    return { repoRoot: session.mirrorRoot, relPaths };
  }
  if (session.project) {
    const p = session.project.fsPathFor(studioPath);
    if (p && existsSync(p)) {
      markServerWrite(p);
      try {
        rmSync(p, { force: true });
      } catch {
        /* best-effort */
      }
      return { repoRoot: session.root, relPaths: [relative(session.root, p)] };
    }
    return { repoRoot: session.root, relPaths: [] };
  }
  return null;
}

/** Single Studio edit (Source change) -> local file. Fast path used by /studio-change. */
export function applyStudioChange(
  session: Session,
  studioPath: string,
  source: string,
  opts: WriterOptions,
  className?: string,
): { written: boolean; relPath?: string } {
  const w = writeOne(session, studioPath, source, className);
  if (!w) return { written: false };
  log(`[${session.placeName}] studio -> file: ${w.relPath}`);
  if (runtimeConfig.gitEnabled && (runtimeConfig.autoCommit || opts.autoCommitOnStudioEdit)) {
    void autoCommit(w.repoRoot, w.relPath, runtimeConfig.autoPush);
  }
  return { written: true, relPath: w.relPath };
}

export interface SyncBatch {
  removes?: { studioPath: string; className?: string }[];
  upserts?: { studioPath: string; source: string; className?: string }[];
}

/** Batched structural sync (delete / paste / duplicate / rename / reparent) ->
 *  local files. Applies all removes + upserts, then makes a SINGLE commit for
 *  the whole batch (so deleting a model of 28 scripts is one commit, not 28). */
export function applyStudioSync(
  session: Session,
  batch: SyncBatch,
  opts: WriterOptions,
): { removed: number; written: number } {
  const changedRel: string[] = [];
  let repoRoot: string | undefined;
  let removed = 0;
  let written = 0;

  for (const r of batch.removes ?? []) {
    const res = removeOne(session, r.studioPath);
    if (res) {
      repoRoot = res.repoRoot;
      for (const rel of res.relPaths) {
        changedRel.push(rel);
        removed++;
        log(`[${session.placeName}] studio delete -> file: ${rel}`);
      }
    }
  }
  for (const u of batch.upserts ?? []) {
    const res = writeOne(session, u.studioPath, u.source, u.className);
    if (res) {
      repoRoot = res.repoRoot;
      changedRel.push(res.relPath);
      written++;
      log(`[${session.placeName}] studio add -> file: ${res.relPath}`);
    }
  }

  if (runtimeConfig.gitEnabled && repoRoot && changedRel.length > 0 && (runtimeConfig.autoCommit || opts.autoCommitOnStudioEdit)) {
    // commit the whole batch as one logical change ("git add ." catches both
    // the writes and the deletions, plus any pruned folders)
    const summary =
      removed && written
        ? `studio: sync (${written} changed, ${removed} removed)`
        : removed
          ? `studio: remove ${removed} script(s)`
          : `studio: add ${written} script(s)`;
    void autoCommitBatch(repoRoot, summary, runtimeConfig.autoPush);
  }
  return { removed, written };
}

// Batch commit: stage everything (handles deletes + new files + pruned dirs) and
// commit once. Reuses simple-git via the git layer.
import { commit as gitCommit, push as gitPush } from "../git/git.js";
async function autoCommitBatch(root: string, message: string, alsoPush: boolean): Promise<void> {
  try {
    await gitCommit(root, message); // commit() does `git add .` then commit
    if (alsoPush) {
      try {
        await gitPush(root);
      } catch {
        /* offline / no remote */
      }
    }
  } catch {
    /* best-effort */
  }
}
