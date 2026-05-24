// Watcher — chokidar watches the project's $path roots. On a file change it
// pushes the new source into Studio via the plugin (files -> Studio).

import chokidar, { type FSWatcher } from "chokidar";
import { readFileSync } from "node:fs";
import type { Project } from "./project.js";
import { classFromFilename, scriptNameFromFile } from "./project.js";
import { wasJustWrittenByServer } from "./loopguard.js";
import { dispatch, isPluginConnected } from "../bridge/queue.js";
import { log } from "../util/log.js";

let watcher: FSWatcher | null = null;

export function startWatcher(project: Project) {
  const roots = project.watchRoots();
  if (roots.length === 0) {
    log("no $path roots to watch — files->Studio sync disabled");
    return;
  }

  watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  const onUpsert = (absPath: string) => {
    const cls = classFromFilename(absPath);
    if (!cls) return;
    if (wasJustWrittenByServer(absPath)) return; // our own studio->file write, skip echo

    const studioPath = project.studioPathFor(absPath);
    if (!studioPath) return;
    if (!isPluginConnected()) return;

    let source = "";
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      return;
    }

    log(`file -> studio: ${project.relFromAbs(absPath)}`);
    void dispatch("applyFileChange", {
      studioPath,
      className: cls,
      kind: "upsert",
      source,
    }).catch((e) => log(`applyFileChange failed: ${e.message}`));
  };

  const onUnlink = (absPath: string) => {
    const studioPath = project.studioPathFor(absPath);
    if (!studioPath || !isPluginConnected()) return;
    log(`file removed -> studio delete: ${project.relFromAbs(absPath)}`);
    void dispatch("applyFileChange", { studioPath, kind: "delete" }).catch((e) =>
      log(`applyFileChange(delete) failed: ${e.message}`),
    );
  };

  watcher.on("add", onUpsert).on("change", onUpsert).on("unlink", onUnlink);
  log(`watching ${roots.length} root(s) for file changes`);
}

export function stopWatcher() {
  void watcher?.close();
  watcher = null;
}
