// Lock — when the plugin isn't connected, the project mirror is made read-only
// so nobody can edit/delete the local files (only copy). Restored to writable
// when the plugin reconnects. On Windows, fs.chmod toggles the read-only
// attribute (write bit). Copying always works; this just blocks edit/delete.

import { readdirSync, statSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

const RO = 0o444;
const RW = 0o644;

function walk(dir: string, mode: number) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) {
        walk(p, mode);
      } else {
        chmodSync(p, mode);
      }
    } catch {
      // best-effort per file
    }
  }
}

export function lockProject(projectRoot: string) {
  if (!existsSync(projectRoot)) return;
  walk(projectRoot, RO);
  log(`locked (read-only): ${projectRoot}`);
}

export function unlockProject(projectRoot: string) {
  if (!existsSync(projectRoot)) return;
  walk(projectRoot, RW);
  log(`unlocked (writable): ${projectRoot}`);
}
