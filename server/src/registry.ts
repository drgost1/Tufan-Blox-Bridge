// Project registry — maps Roblox PlaceId to a filesystem project root.
// Persisted at ~/.tufan-blox-bridge/projects.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { log } from "./util/log.js";

/** Normalize a filesystem path for robust comparison (absolute, no trailing
 *  separator, case-insensitive — Windows paths are case-insensitive and may
 *  arrive with mixed / and \\ separators). */
function normRoot(p: string): string {
  try {
    return resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  } catch {
    return p.replace(/[\\/]+$/, "").toLowerCase();
  }
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
  const clean: ProjectEntry = { ...entry, root: resolve(entry.root) };
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

  const primary = process.env.TUFAN_PROJECT;
  if (primary) {
    const boundPlace = getPlaceIdByRoot(primary);
    if (!boundPlace) {
      const entry: ProjectEntry = { name: placeName, root: primary, gameId };
      register(placeId, entry);
      return entry;
    }
  }

  const safeName = placeName.replace(/[^A-Za-z0-9_-]/g, "_") || "Place";
  const root = join(baseProjectsDir(), `${safeName}_${placeId}`);
  mkdirSync(root, { recursive: true });
  const entry: ProjectEntry = { name: placeName, root, gameId };
  register(placeId, entry);
  return entry;
}
