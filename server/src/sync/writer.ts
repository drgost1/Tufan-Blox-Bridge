// Writer — applies a Studio-side script change to the filesystem for a session.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Session } from "../bridge/sessions.js";
import { markServerWrite } from "./loopguard.js";
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
  if (!session.project) {
    return { written: false };
  }
  const absPath =
    session.project.fsPathFor(studioPath) ?? session.project.computeFsPath(studioPath, className);
  if (!absPath) {
    return { written: false }; // unmapped path — silently ignore
  }

  markServerWrite(absPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, source, "utf8");

  const relPath = session.project.relFromAbs(absPath);
  log(`[${session.placeName}] studio -> file: ${relPath}`);

  // Runtime toggles (plugin git switches) take precedence over the launch env.
  if (runtimeConfig.autoCommit || opts.autoCommitOnStudioEdit) {
    void autoCommit(session.root, relPath, runtimeConfig.autoPush);
  }
  return { written: true, relPath };
}
