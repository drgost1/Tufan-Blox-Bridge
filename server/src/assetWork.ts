// Work directory for the asset-generation pipeline. Generated GLBs, PBR maps
// and Blender-processed outputs land here, keyed by the Meshy task id (or a
// caller-supplied slug) so files never collide and stay traceable to their
// task. Keep-all policy: generated assets are the user's property — nothing is
// auto-deleted. Override the root with TUFAN_ASSET_DIR.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export function assetRoot(): string {
  return process.env.TUFAN_ASSET_DIR?.trim() || join(homedir(), ".tufan-blox-bridge", "assets");
}

/** Sanitize a task id / name into a safe directory segment. */
export function safeSlug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "asset";
}

/** Ensure and return the per-task work directory. */
export async function workDir(slug: string): Promise<string> {
  const d = join(assetRoot(), safeSlug(slug));
  await mkdir(d, { recursive: true });
  return d;
}
