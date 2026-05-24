// Mirror — maps a Studio instance path to a local file under a project folder,
// and back. The folder structure mirrors the Studio tree directly (no
// project.json needed): ServerScriptService.MusicService -> ServerScriptService/MusicService.server.lua
//
// This backs the "open a place -> its tree appears locally" model. Scripts are
// written as editable source; non-script instance structure is a later slice.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
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
