// Writer — applies a Studio-side script change to the local files. Targets the
// per-place mirror (projects/<exp>/<place>/) when present; falls back to the
// legacy project.json mapping otherwise. Auto-commits/pushes per runtime config.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { Session } from "../bridge/sessions.js";
import { markServerWrite } from "./loopguard.js";
import { writeMirrorScriptLive } from "./mirror.js";
import { autoCommit } from "../git/git.js";
import { runtimeConfig } from "../config.js";
import { log } from "../util/log.js";

export interface WriterOptions {
  autoCommitOnStudioEdit: boolean;
}

export function applyStudioChange(
  session: Session,
  studioPath: string,
  source: string,
  opts: WriterOptions,
  className?: string,
): { written: boolean; relPath?: string } {
  let absPath: string | undefined;
  let repoRoot: string | undefined;

  if (session.mirrorRoot) {
    absPath = writeMirrorScriptLive(session.mirrorRoot, studioPath, className ?? "ModuleScript", source);
    repoRoot = session.mirrorRoot;
  } else if (session.project) {
    // legacy project.json mapping
    const p = session.project.fsPathFor(studioPath) ?? session.project.computeFsPath(studioPath, className);
    if (!p) return { written: false };
    markServerWrite(p);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, source, "utf8");
    absPath = p;
    repoRoot = session.root;
  } else {
    return { written: false };
  }

  const relPath = relative(repoRoot!, absPath);
  log(`[${session.placeName}] studio -> file: ${relPath}`);

  if (runtimeConfig.autoCommit || opts.autoCommitOnStudioEdit) {
    void autoCommit(repoRoot!, relPath, runtimeConfig.autoPush);
  }
  return { written: true, relPath };
}
