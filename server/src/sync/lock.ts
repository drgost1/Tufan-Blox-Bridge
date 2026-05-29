// Lock — when the plugin isn't connected, the project mirror is made read-only
// so nobody can edit/delete the local files (only copy). Restored to writable
// when the plugin reconnects. On Windows, fs.chmod toggles the read-only
// attribute (write bit). Copying always works; this just blocks edit/delete.

import { existsSync } from "node:fs";
import { readdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../util/log.js";

const RO = 0o444;
const RW = 0o644;

// Async + yields between entries (the await points hand control back to the event
// loop) so locking/unlocking a large mirror never blocks the HTTP poll bridge on
// the single Node thread. Runs only on disconnect/reconnect, so this is belt-and-
// suspenders, but it keeps even a big tree from causing a poll hiccup.
async function walk(dir: string, mode: number): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) {
        await walk(p, mode);
      } else {
        await chmod(p, mode);
      }
    } catch {
      // best-effort per file
    }
  }
}

export async function lockProject(projectRoot: string): Promise<void> {
  if (!existsSync(projectRoot)) return;
  await walk(projectRoot, RO);
  log(`locked (read-only): ${projectRoot}`);
}

export async function unlockProject(projectRoot: string): Promise<void> {
  if (!existsSync(projectRoot)) return;
  await walk(projectRoot, RW);
  log(`unlocked (writable): ${projectRoot}`);
}
