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

  fsPathFor(studioPath: string): string | undefined {
    return this.studioToFs.get(studioPath);
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
