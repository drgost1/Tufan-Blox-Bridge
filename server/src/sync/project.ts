// Project mapping — parses a Rojo/Argon-style project.json and builds a
// bidirectional map between filesystem paths and Studio instance paths.
//
// Filename conventions (Rojo-compatible):
//   foo.server.luau  -> Script "foo"
//   foo.client.luau  -> LocalScript "foo"
//   foo.luau         -> ModuleScript "foo"
//   init.server.luau in dir X -> X becomes a Script (folder-as-script)

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface ProjectNode {
  $className?: string;
  $path?: string;
  [child: string]: ProjectNode | string | undefined;
}

export interface ProjectFile {
  name: string;
  tree: ProjectNode;
}

export interface ScriptClass {
  className: "Script" | "LocalScript" | "ModuleScript";
}

export interface MappedScript {
  absPath: string;
  relPath: string;
  studioPath: string;
  className: ScriptClass["className"];
}

export function classFromFilename(file: string): ScriptClass["className"] | null {
  if (file.endsWith(".server.luau") || file.endsWith(".server.lua")) return "Script";
  if (file.endsWith(".client.luau") || file.endsWith(".client.lua")) return "LocalScript";
  if (file.endsWith(".luau") || file.endsWith(".lua")) return "ModuleScript";
  return null;
}

export function scriptNameFromFile(file: string): string {
  return file
    .replace(/\.server\.luau$/, "")
    .replace(/\.client\.luau$/, "")
    .replace(/\.server\.lua$/, "")
    .replace(/\.client\.lua$/, "")
    .replace(/\.luau$/, "")
    .replace(/\.lua$/, "");
}

export class Project {
  readonly root: string;
  readonly file: ProjectFile;
  /** maps absolute fs path -> studio path */
  private fsToStudio = new Map<string, string>();
  /** maps studio path -> absolute fs path */
  private studioToFs = new Map<string, string>();
  /** $path roots: absolute dir -> studio prefix (for dynamic path computation) */
  private rootMappings: { absDir: string; studioPrefix: string }[] = [];

  constructor(root: string, file: ProjectFile) {
    this.root = root;
    this.file = file;
    this.walk(file.tree, "");
  }

  static load(root: string): Project | null {
    for (const candidate of ["default.project.json", "tufan.project.json"]) {
      const p = join(root, candidate);
      if (existsSync(p)) {
        const file = JSON.parse(readFileSync(p, "utf8")) as ProjectFile;
        return new Project(root, file);
      }
    }
    return null;
  }

  /** Recursively walk the project tree, mapping any $path dirs to script files. */
  private walk(node: ProjectNode, studioPrefix: string) {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (typeof value !== "object" || value === null) continue;

      const childNode = value as ProjectNode;
      const studioPath = studioPrefix ? `${studioPrefix}.${key}` : key;

      if (typeof childNode.$path === "string") {
        const absDir = join(this.root, childNode.$path);
        if (existsSync(absDir) && statSync(absDir).isDirectory()) {
          this.rootMappings.push({ absDir, studioPrefix: studioPath });
          this.mapDir(absDir, studioPath);
        }
      }
      this.walk(childNode, studioPath);
    }
  }

  private mapDir(absDir: string, studioPrefix: string) {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        // folder-as-script if it contains init.*
        const initFile = ["init.server.luau", "init.client.luau", "init.luau"]
          .map((f) => join(abs, f))
          .find((f) => existsSync(f));
        const studioPath = `${studioPrefix}.${entry.name}`;
        if (initFile) {
          this.register(initFile, studioPath, classFromFilename(initFile)!);
        }
        this.mapDir(abs, studioPath);
      } else {
        const cls = classFromFilename(entry.name);
        if (!cls || entry.name.startsWith("init.")) continue;
        const studioPath = `${studioPrefix}.${scriptNameFromFile(entry.name)}`;
        this.register(abs, studioPath, cls);
      }
    }
  }

  private register(abs: string, studioPath: string, _cls: ScriptClass["className"]) {
    this.fsToStudio.set(abs, studioPath);
    this.studioToFs.set(studioPath, abs);
  }

  studioPathFor(absPath: string): string | undefined {
    return this.fsToStudio.get(absPath);
  }

  /**
   * Compute the studio path for any file under a $path root — including files
   * that did not exist when the project was loaded (new files). Returns
   * undefined if the path isn't a script under a mapped root.
   */
  computeStudioPath(absPath: string): string | undefined {
    if (!classFromFilename(absPath)) return undefined;
    let best: { absDir: string; studioPrefix: string } | undefined;
    for (const m of this.rootMappings) {
      const prefix = m.absDir + sep;
      if (absPath.startsWith(prefix) || absPath === m.absDir) {
        if (!best || m.absDir.length > best.absDir.length) best = m;
      }
    }
    if (!best) return undefined;

    const rel = relative(best.absDir, absPath).split(sep);
    const leaf = rel.pop()!;
    const dirs = rel; // intermediate folders
    const parts = [best.studioPrefix, ...dirs];
    if (!leaf.startsWith("init.")) {
      parts.push(scriptNameFromFile(leaf));
    }
    return parts.join(".");
  }

  fsPathFor(studioPath: string): string | undefined {
    return this.studioToFs.get(studioPath);
  }

  /**
   * Compute the filesystem path for a studio path (reverse of
   * computeStudioPath), resolving the right extension by className. Reuses an
   * existing file if one is already present (matching .lua/.luau); otherwise
   * returns the preferred new-file path. Returns undefined if the studio path
   * isn't under a mapped root.
   */
  computeFsPath(studioPath: string, className?: string): string | undefined {
    const extsByClass: Record<string, string[]> = {
      Script: [".server.luau", ".server.lua"],
      LocalScript: [".client.luau", ".client.lua"],
      ModuleScript: [".luau", ".lua"],
    };

    let best: { absDir: string; studioPrefix: string } | undefined;
    for (const m of this.rootMappings) {
      if (studioPath === m.studioPrefix || studioPath.startsWith(m.studioPrefix + ".")) {
        if (!best || m.studioPrefix.length > best.studioPrefix.length) best = m;
      }
    }
    if (!best) return undefined;

    const relStudio = studioPath === best.studioPrefix ? "" : studioPath.slice(best.studioPrefix.length + 1);
    const parts = relStudio ? relStudio.split(".") : [];
    const leaf = parts.pop();
    if (!leaf) return undefined;
    const dirAbs = parts.length ? join(best.absDir, ...parts) : best.absDir;

    const exts = extsByClass[className ?? ""] ?? [".luau", ".lua", ".server.luau", ".server.lua", ".client.luau", ".client.lua"];
    for (const ext of exts) {
      const candidate = join(dirAbs, leaf + ext);
      if (existsSync(candidate)) return candidate;
    }
    return join(dirAbs, leaf + exts[0]);
  }

  relFromAbs(absPath: string): string {
    return relative(this.root, absPath).split(sep).join("/");
  }

  allScripts(): MappedScript[] {
    const out: MappedScript[] = [];
    for (const [abs, studioPath] of this.fsToStudio) {
      out.push({
        absPath: abs,
        relPath: this.relFromAbs(abs),
        studioPath,
        className: classFromFilename(abs) ?? "ModuleScript",
      });
    }
    return out;
  }

  /** Directories chokidar should watch (the $path roots). */
  watchRoots(): string[] {
    const roots = new Set<string>();
    const collect = (node: ProjectNode) => {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("$")) continue;
        if (typeof value !== "object" || value === null) continue;
        const child = value as ProjectNode;
        if (typeof child.$path === "string") {
          const abs = join(this.root, child.$path);
          if (existsSync(abs)) roots.add(abs);
        }
        collect(child);
      }
    };
    collect(this.file.tree);
    return [...roots];
  }
}
