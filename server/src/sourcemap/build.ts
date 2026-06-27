// Build a Rojo-style sourcemap from a place's on-disk script mirror — the file
// luau-lsp consumes to resolve `require` paths and provide IntelliSense/types.
// Pure filesystem walk (no Studio, no mutation): the mirror already holds the
// script tree as files (see sync/mirror.ts), so the sourcemap is derivable from
// disk alone. Reflects scripts + their containing folders; non-script instances
// aren't on disk and aren't represented (luau-lsp only needs the script tree).

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface SourcemapNode {
  name: string;
  className: string;
  filePaths?: string[];
  children?: SourcemapNode[];
}

// Mirror of EXT_BY_CLASS in sync/mirror.ts (both .lua and .luau spellings).
const EXT_CLASS: { suffix: string; className: string }[] = [
  { suffix: ".server.lua", className: "Script" },
  { suffix: ".server.luau", className: "Script" },
  { suffix: ".client.lua", className: "LocalScript" },
  { suffix: ".client.luau", className: "LocalScript" },
  { suffix: ".lua", className: "ModuleScript" },
  { suffix: ".luau", className: "ModuleScript" },
];

// Windows 260-char path cap workaround (matches sync/mirror.ts longPath).
function longPath(p: string): string {
  if (process.platform !== "win32") return p;
  const native = p.replace(/\//g, "\\");
  return native.startsWith("\\\\?\\") ? native : "\\\\?\\" + native;
}

function scriptClass(file: string): { className: string; suffix: string } | null {
  // longest suffix first so ".server.lua" wins over ".lua"
  for (const e of EXT_CLASS) if (file.endsWith(e.suffix)) return { className: e.className, suffix: e.suffix };
  return null;
}

const INIT_RE = /^init(\.server|\.client)?\.luau?$/;

// forward-slashed path relative to root (sourcemap convention, cross-platform)
function relTo(root: string, p: string): string {
  return relative(root, p).split(/[\\/]/).join("/");
}

function readDir(dir: string): string[] {
  try {
    return readdirSync(longPath(dir));
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(longPath(p)).isDirectory();
  } catch {
    return false;
  }
}

function buildDir(root: string, dir: string, name: string, isTopLevel: boolean): SourcemapNode {
  const entries = readDir(dir);

  // A folder-as-script (Rojo init convention) makes the FOLDER itself the script.
  let init: { file: string; className: string } | null = null;
  for (const e of entries) {
    if (INIT_RE.test(e)) {
      const sc = scriptClass(e);
      if (sc) {
        init = { file: e, className: sc.className };
        break;
      }
    }
  }

  const node: SourcemapNode = init
    ? { name, className: init.className, filePaths: [relTo(root, join(dir, init.file))] }
    : { name, className: isTopLevel ? name : "Folder" }; // top-level folders are services (named after their class)

  const children: SourcemapNode[] = [];
  for (const e of entries) {
    if (e.startsWith(".")) continue; // skip .git etc. at every level
    const abs = join(dir, e);
    if (isDir(abs)) {
      children.push(buildDir(root, abs, e, false));
      continue;
    }
    if (init && e === init.file) continue; // already represented by this node
    const sc = scriptClass(e);
    if (!sc) continue; // non-script file
    const scriptName = e.slice(0, e.length - sc.suffix.length);
    if (scriptName === "init") continue; // stray init form already handled / not a leaf
    children.push({ name: scriptName, className: sc.className, filePaths: [relTo(root, abs)] });
  }
  if (children.length) node.children = children;
  return node;
}

/** Walk the mirror root into a sourcemap tree. Top-level folders are services. */
export function buildSourcemap(root: string, gameName = "game"): SourcemapNode {
  const children: SourcemapNode[] = [];
  for (const e of readDir(root)) {
    if (e.startsWith(".")) continue; // .git, dotfiles
    const abs = join(root, e);
    if (isDir(abs)) {
      children.push(buildDir(root, abs, e, true));
    } else {
      const sc = scriptClass(e);
      if (!sc) continue;
      const scriptName = e.slice(0, e.length - sc.suffix.length);
      if (scriptName === "init") continue;
      children.push({ name: scriptName, className: sc.className, filePaths: [relTo(root, abs)] });
    }
  }
  const rootNode: SourcemapNode = { name: gameName, className: "DataModel" };
  if (children.length) rootNode.children = children;
  return rootNode;
}

/** Count script nodes (those with filePaths) in a sourcemap tree. */
export function countScripts(node: SourcemapNode): number {
  let n = node.filePaths ? 1 : 0;
  for (const c of node.children ?? []) n += countScripts(c);
  return n;
}
