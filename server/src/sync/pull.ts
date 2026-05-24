// Pull — dump a connected place's full script tree into its local mirror folder.
// Runs automatically on connect and can be triggered via the pull_place tool.

import type { Session } from "../bridge/sessions.js";
import { dispatchTo } from "../bridge/sessions.js";
import { writeMirrorScript } from "./mirror.js";
import { unlockProject } from "./lock.js";
import { log } from "../util/log.js";

export async function pullPlace(session: Session): Promise<number> {
  if (!session.mirrorRoot) return 0; // unpublished place — no mirror
  unlockProject(session.mirrorRoot); // must be writable to pull into
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
  for (const s of scripts) {
    try {
      writeMirrorScript(session.mirrorRoot, s.studioPath, s.className, s.source, hasChildren(s.studioPath));
      written++;
    } catch {
      // skip unwritable entries (e.g. path too long)
    }
  }
  log(`[${session.placeName}] pulled ${written} scripts -> ${session.mirrorRoot}`);
  return written;
}
