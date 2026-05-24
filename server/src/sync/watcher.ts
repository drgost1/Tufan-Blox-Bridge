// Per-session file watcher. Each connected project gets its own chokidar
// watcher that pushes file changes into that place (files -> Studio).

import chokidar, { type FSWatcher } from "chokidar";
import { readFileSync } from "node:fs";
import type { Session } from "../bridge/sessions.js";
import { classFromFilename } from "./project.js";
import { wasJustWrittenByServer } from "./loopguard.js";
import { dispatchTo } from "../bridge/sessions.js";
import { log } from "../util/log.js";

const watchers = new Map<string, FSWatcher>(); // sessionId -> watcher

export function startWatcherForSession(session: Session) {
  if (!session.project) return;
  // one watcher per place; replace any prior for this place
  stopWatcherForSession(session.sessionId);

  const roots = session.project.watchRoots();
  if (roots.length === 0) {
    log(`[${session.placeName}] no $path roots — files->Studio disabled`);
    return;
  }

  const w = chokidar.watch(roots, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  const upsert = (absPath: string) => {
    const cls = classFromFilename(absPath);
    if (!cls) return;
    if (wasJustWrittenByServer(absPath)) return;
    const studioPath = session.project!.computeStudioPath(absPath);
    if (!studioPath) return;
    let source = "";
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      return;
    }
    log(`[${session.placeName}] file -> studio: ${session.project!.relFromAbs(absPath)}`);
    void dispatchTo(session.placeId, "applyFileChange", {
      studioPath,
      className: cls,
      kind: "upsert",
      source,
    }).catch((e) => log(`applyFileChange failed: ${e.message}`));
  };

  const unlink = (absPath: string) => {
    const studioPath = session.project!.computeStudioPath(absPath);
    if (!studioPath) return;
    void dispatchTo(session.placeId, "applyFileChange", { studioPath, kind: "delete" }).catch(
      (e) => log(`applyFileChange(delete) failed: ${e.message}`),
    );
  };

  w.on("add", upsert).on("change", upsert).on("unlink", unlink);
  watchers.set(session.sessionId, w);
  log(`[${session.placeName}] watching ${roots.length} root(s)`);
}

export function stopWatcherForSession(sessionId: string) {
  const w = watchers.get(sessionId);
  if (w) {
    void w.close();
    watchers.delete(sessionId);
  }
}
