// Project registry — maps Roblox PlaceId to a filesystem project root.
// Persisted at ~/.tufan-blox-bridge/projects.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { log } from "./util/log.js";

/** Normalize a path: tolerate forward OR back slashes, resolve to absolute.
 *  (Windows process-spawn can eat backslashes in env values, so forward slashes
 *  are the safe form — Node handles them natively on Windows.) */
export function cleanPath(p: string): string {
  return resolve(p.replace(/\\/g, "/"));
}

/** Normalize for comparison (absolute, no trailing sep, case-insensitive). */
function normRoot(p: string): string {
  try {
    return cleanPath(p).replace(/[\\/]+$/, "").toLowerCase();
  } catch {
    return p.replace(/[\\/]+$/, "").toLowerCase();
  }
}

/** The validated project base dir. Falls back to cwd with a clear warning if
 *  TUFAN_PROJECT is missing/invalid (e.g. mangled by env backslash-eating). */
export function validatedBase(): string {
  const raw = process.env.TUFAN_PROJECT;
  if (raw) {
    const norm = cleanPath(raw);
    if (existsSync(norm)) return norm;
    log(`WARNING: TUFAN_PROJECT="${raw}" is not a valid directory (resolved "${norm}"). Use forward slashes, e.g. C:/Users/you/project. Falling back to cwd: ${process.cwd()}`);
  }
  return process.cwd();
}

export interface ProjectEntry {
  name: string;
  root: string;
  gameId?: number;
}

const CONFIG_DIR = join(homedir(), ".tufan-blox-bridge");
const REGISTRY_FILE = join(CONFIG_DIR, "projects.json");

function baseProjectsDir(): string {
  return process.env.TUFAN_PROJECTS_DIR ?? join(homedir(), "TufanProjects");
}

type RegistryShape = Record<string, ProjectEntry>; // keyed by placeId (string)

let registry: RegistryShape = {};

export function loadRegistry() {
  try {
    if (existsSync(REGISTRY_FILE)) {
      registry = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
      log(`registry: ${Object.keys(registry).length} project(s) loaded`);
    }
  } catch (e) {
    log(`registry load failed: ${(e as Error).message}`);
    registry = {};
  }
}

function save() {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf8");
  } catch (e) {
    log(`registry save failed: ${(e as Error).message}`);
  }
}

export function getByPlaceId(placeId: number | string): ProjectEntry | undefined {
  return registry[String(placeId)];
}

export function getPlaceIdByRoot(root: string): string | undefined {
  const norm = normRoot(root);
  for (const [placeId, entry] of Object.entries(registry)) {
    if (normRoot(entry.root) === norm) return placeId;
  }
  return undefined;
}

export function getPlaceIdByName(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [placeId, entry] of Object.entries(registry)) {
    if (entry.name.toLowerCase() === lower) return placeId;
  }
  return undefined;
}

export function register(placeId: number | string, entry: ProjectEntry) {
  // Store a clean absolute path so the file never holds mangled separators.
  const clean: ProjectEntry = { ...entry, root: cleanPath(entry.root) };
  registry[String(placeId)] = clean;
  save();
  log(`registry: bound place ${placeId} ("${clean.name}") -> ${clean.root}`);
}

/**
 * Resolve the project root for a connecting place, per the binding policy:
 *  1. known placeId -> its root
 *  2. TUFAN_PROJECT set and not yet bound -> bind this place to it
 *  3. else auto-register under the base projects dir
 */
export function resolveProjectForPlace(
  placeId: number,
  placeName: string,
  gameId: number | undefined,
): ProjectEntry {
  const existing = getByPlaceId(placeId);
  if (existing) return existing;

  const primary = process.env.TUFAN_PROJECT ? validatedBase() : undefined;
  if (primary) {
    const boundPlace = getPlaceIdByRoot(primary);
    if (!boundPlace) {
      const entry: ProjectEntry = { name: placeName, root: primary, gameId };
      register(placeId, entry);
      return entry;
    }
  }

  const safeName = placeName.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Place";
  const root = join(baseProjectsDir(), `${safeName}_${placeId}`);
  mkdirSync(root, { recursive: true });
  const entry: ProjectEntry = { name: placeName, root, gameId };
  register(placeId, entry);
  return entry;
}
