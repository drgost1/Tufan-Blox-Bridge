// Pull — dump a connected place's full script tree into its local mirror folder.
// Runs automatically on connect and can be triggered via the pull_place tool.

import type { Session } from "../bridge/sessions.js";
import { dispatchTo } from "../bridge/sessions.js";
import { writeMirrorScript } from "./mirror.js";
import { unlockProject } from "./lock.js";
import { snapshotIfDirty } from "../git/git.js";
import { runtimeConfig } from "../config.js";
import { log } from "../util/log.js";

export async function pullPlace(session: Session): Promise<number> {
  if (!session.mirrorRoot) return 0; // unpublished place — no mirror

  // H4 safety (git only): commit whatever's in the mirror before overwriting, so
  // a re-pull is always recoverable. Skipped when git is off (no repo to snapshot).
  // If the protective commit fails (e.g. git identity unset on a fresh machine),
  // REFUSE to overwrite — better a blocked pull than silently lost uncommitted work.
  if (runtimeConfig.gitEnabled) {
    try {
      await snapshotIfDirty(session.mirrorRoot, "pre-pull snapshot (auto)");
    } catch (e) {
      log(`[${session.placeName}] ⚠ pre-pull snapshot failed — refusing to overwrite uncommitted mirror. Fix git (e.g. set user.email) or disable git. ${(e as Error).message}`);
      throw e; // abort BEFORE unlock/write — do not touch the mirror
    }
  }

  await unlockProject(session.mirrorRoot); // must be writable to pull into
  const res: any = await dispatchTo(session.placeId, "pullAll", {}, 60_000);
  const scripts: any[] = res?.scripts ?? [];

  // A script with descendant scripts must be written folder-as-script (init.*)
  // so its children can nest under it without a file/folder name collision.
  const paths = new Set<string>(scripts.map((s) => s.studioPath));
  const hasChildren = (p: string) => {
    const pre = p + ".";
    for (const q of paths) if (q !== p && q.startsWith(pre)) return true;
    return false;
  };

  let written = 0;
  let failed = 0;
  for (const s of scripts) {
    try {
      writeMirrorScript(session.mirrorRoot, s.studioPath, s.className, s.source, hasChildren(s.studioPath));
      written++;
    } catch {
      failed++; // unwritable entry (e.g. path too long) — counted, not silent
    }
  }
  // M7: self-verify. The plugin reports how many scripts it found; a gap means a
  // partial/failed pull — surface it instead of trusting the mirror blindly.
  const reported = scripts.length;
  if (reported === 0) {
    // Pull is additive-only (it never deletes), so a 0-script result leaves the
    // existing mirror untouched — but a real place has scripts, so 0 almost
    // always means a transient Studio glitch. Flag it rather than log "0/0" ok.
    log(`[${session.placeName}] ⚠ pull returned 0 scripts — existing mirror left untouched (transient Studio glitch?)`);
  } else if (written !== reported) {
    log(`[${session.placeName}] ⚠ pull mismatch: Studio reported ${reported} scripts, wrote ${written}${failed ? ` (${failed} failed)` : ""}`);
  } else {
    log(`[${session.placeName}] pulled ${written}/${reported} scripts -> ${session.mirrorRoot}`);
  }
  return written;
}
