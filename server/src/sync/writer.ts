// Writer — applies a Studio-side script change to the filesystem.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Project } from "./project.js";
import { markServerWrite } from "./loopguard.js";
import { autoCommit } from "../git/git.js";
import { log } from "../util/log.js";

export interface WriterOptions {
  autoCommitOnStudioEdit: boolean;
}

export function applyStudioChange(
  project: Project,
  studioPath: string,
  source: string,
  opts: WriterOptions,
): { written: boolean; relPath?: string } {
  const absPath = project.fsPathFor(studioPath);
  if (!absPath) {
    log(`studio-change for unmapped path "${studioPath}" — ignored`);
    return { written: false };
  }

  markServerWrite(absPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, source, "utf8");

  const relPath = project.relFromAbs(absPath);
  log(`studio -> file: ${relPath} (${source.length} bytes)`);

  if (opts.autoCommitOnStudioEdit) {
    void autoCommit(relPath);
  }

  return { written: true, relPath };
}
