// Mirror — maps a Studio instance path to a local file under a project folder,
// and back. The folder structure mirrors the Studio tree directly (no
// project.json needed): ServerScriptService.MusicService -> ServerScriptService/MusicService.server.lua
//
// This backs the "open a place -> its tree appears locally" model. Scripts are
// written as editable source; non-script instance structure is a later slice.

import { writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, rmdirSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { markServerWrite } from "./loopguard.js";

// Windows caps paths at 260 chars unless prefixed with \\?\ (and using
// backslashes). Deep Studio trees blow past that, so we prefix fs writes.
function longPath(p: string): string {
  if (process.platform !== "win32") return p;
  const native = p.replace(/\//g, "\\");
  return native.startsWith("\\\\?\\") ? native : "\\\\?\\" + native;
}

const EXT_BY_CLASS: Record<string, string> = {
  Script: ".server.lua",
  LocalScript: ".client.lua",
  ModuleScript: ".lua",
};

function sanitizeSegment(s: string): string {
  // keep it filesystem-safe but readable
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

export function mirrorFilePath(
  projectRoot: string,
  studioPath: string,
  className: string,
  hasChildren = false,
): string {
  const segs = studioPath.split(".").map(sanitizeSegment);
  const ext = EXT_BY_CLASS[className] ?? ".lua";
  if (hasChildren) {
    // folder-as-script (Rojo init convention): <segs...>/init.<ext>, so the
    // script can be a folder that also holds its child instances.
    return join(projectRoot, ...segs, "init" + ext);
  }
  const leaf = segs.pop()!;
  return join(projectRoot, ...segs, leaf + ext);
}

export function writeMirrorScript(
  projectRoot: string,
  studioPath: string,
  className: string,
  source: string,
  hasChildren = false,
): string {
  const p = mirrorFilePath(projectRoot, studioPath, className, hasChildren);
  markServerWrite(p); // loop guard keys on the clean path the watcher reports
  const lp = longPath(p);
  mkdirSync(dirname(lp), { recursive: true });
  writeFileSync(lp, source, "utf8");
  return p;
}

/** Write a live Studio edit to the mirror, preferring an existing file path
 *  (init-style if the script is a folder-script, else leaf). */
export function writeMirrorScriptLive(
  projectRoot: string,
  studioPath: string,
  className: string,
  source: string,
): string {
  const initPath = mirrorFilePath(projectRoot, studioPath, className, true);
  const leafPath = mirrorFilePath(projectRoot, studioPath, className, false);
  const target = existsSync(longPath(initPath)) ? initPath : leafPath;
  markServerWrite(target);
  const lp = longPath(target);
  mkdirSync(dirname(lp), { recursive: true });
  writeFileSync(lp, source, "utf8");
  return target;
}

// Every script-file spelling. A given Studio path maps to exactly one script
// instance, so at most one of these files exists — "delete whichever exists" is
// safe and means removal works even without knowing the removed script's class
// (the instance is already gone by the time the plugin reports it).
const ALL_SCRIPT_EXTS = [
  ".server.lua",
  ".server.luau",
  ".client.lua",
  ".client.luau",
  ".lua",
  ".luau",
];

/** Delete empty parent folders upward from `startDir`, stopping at projectRoot.
 *  Used after a script (or a whole model of scripts) is removed in Studio so the
 *  mirror doesn't keep hollow folders around. */
function pruneEmptyDirs(projectRoot: string, startDir: string): void {
  const root = resolve(projectRoot);
  let dir = startDir;
  while (true) {
    const abs = resolve(dir);
    if (abs === root || !abs.startsWith(root + sep)) break; // never touch the root itself or escape it
    const lp = longPath(dir);
    if (!existsSync(lp)) {
      dir = dirname(dir);
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(lp);
    } catch {
      break;
    }
    if (entries.length > 0) break; // not empty — leave it (still holds other scripts)
    try {
      rmdirSync(lp);
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

/** Remove the mirror file(s) for a Studio script that was deleted/moved away.
 *  Tries both the leaf form (<segs>/Name.ext) and the folder-script form
 *  (<segs>/Name/init.ext), and both `.lua`/`.luau` spellings, then prunes any
 *  folders left empty. Returns the relative paths that were actually removed. */
export function removeMirrorScript(projectRoot: string, studioPath: string): string[] {
  const segs = studioPath.split(".").map(sanitizeSegment);
  const leaf = segs[segs.length - 1];
  const parentSegs = segs.slice(0, -1);
  const removed: string[] = [];

  for (const ext of ALL_SCRIPT_EXTS) {
    const candidates = [
      join(projectRoot, ...parentSegs, leaf + ext), // leaf form
      join(projectRoot, ...segs, "init" + ext), // folder-script (init) form
    ];
    for (const c of candidates) {
      const lp = longPath(c);
      if (existsSync(lp)) {
        markServerWrite(c); // suppress the chokidar unlink echo back into Studio
        try {
          rmSync(lp, { force: true });
          removed.push(relative(projectRoot, c));
        } catch {
          /* best-effort */
        }
      }
    }
  }

  // prune the folder-script dir (segs) and the leaf's parent dir (parentSegs)
  pruneEmptyDirs(projectRoot, join(projectRoot, ...segs));
  if (parentSegs.length > 0) pruneEmptyDirs(projectRoot, join(projectRoot, ...parentSegs));
  return removed;
}

const CLASS_BY_EXT: { suffix: string; className: string }[] = [
  { suffix: ".server.lua", className: "Script" },
  { suffix: ".server.luau", className: "Script" },
  { suffix: ".client.lua", className: "LocalScript" },
  { suffix: ".client.luau", className: "LocalScript" },
  { suffix: ".lua", className: "ModuleScript" },
  { suffix: ".luau", className: "ModuleScript" },
];

/** Reverse: a mirror file path -> { studioPath, className } (for file->Studio). */
export function studioPathFromMirror(
  projectRoot: string,
  absPath: string,
): { studioPath: string; className: string } | null {
  const rel = relative(projectRoot, absPath);
  if (rel.startsWith("..")) return null;
  const match = CLASS_BY_EXT.find((c) => absPath.endsWith(c.suffix));
  if (!match) return null;
  const parts = rel.split(sep);
  const file = parts.pop()!;
  const name = file.slice(0, file.length - match.suffix.length);
  if (name === "init") {
    // folder-as-script: the studio path IS the folder path
    if (parts.length === 0) return null;
    return { studioPath: parts.join("."), className: match.className };
  }
  parts.push(name);
  return { studioPath: parts.join("."), className: match.className };
}
