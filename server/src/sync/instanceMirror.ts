// Instance mirror — writes the plugin's InstanceWatcher uploads (binary .rbxm,
// one file per direct child of a tracked service) next to the script mirror:
//   <mirrorRoot>/StarterGui/MineGui.rbxm
//   <mirrorRoot>/ReplicatedStorage/Mining.rbxm
// Every overwrite/delete first goes through history.preserve(), so a removed or
// undone object can be restored later with restore_from_mirror.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Session } from "../bridge/sessions.js";
import { markServerWrite } from "./loopguard.js";
import { ensureWritable, historyFile, longPath, preserve, readHistory, type HistoryEntry, type HistoryReason } from "./history.js";
import { log } from "../util/log.js";

export const INSTANCE_EXT = ".rbxm";

// Changes whenever this server process or the place's mirror folder changes.
// The plugin keeps a cache of what it uploaded; when the epoch it gets back
// differs from the last one, it drops that cache and uploads everything again,
// so a restarted server (or a moved mirror) is never left half-filled.
const PROCESS_EPOCH = randomUUID();
function epochFor(root: string): string {
  return `${PROCESS_EPOCH}|${root}`;
}

export function sanitizeSegment(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

/** Mirror-relative path (forward slashes) of a unit file. */
export function unitRel(service: string, name: string): string {
  return `${sanitizeSegment(service)}/${sanitizeSegment(name)}${INSTANCE_EXT}`;
}

function splitKey(studioPath: string): { service: string; name: string } {
  const dot = studioPath.indexOf(".");
  return { service: studioPath.slice(0, dot), name: studioPath.slice(dot + 1) };
}

export interface InstanceUpsert {
  studioPath: string;
  service: string;
  name: string;
  className?: string;
  reason?: string;
  data: string; // base64 .rbxm
}

export interface InstanceSyncBody {
  upserts?: InstanceUpsert[];
  removes?: { studioPath: string }[];
  manifest?: string[]; // every unit currently in Studio (first flush after the plugin starts)
  services?: string[]; // tracked services the manifest covers
}

function removeUnitFile(root: string, rel: string, studioPath: string, reason: HistoryReason): boolean {
  const abs = join(root, rel);
  if (!existsSync(longPath(abs))) return false;
  preserve(root, rel, studioPath, "instance", reason);
  markServerWrite(abs);
  ensureWritable(abs);
  try {
    rmSync(longPath(abs), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function applyInstanceSync(
  session: Session,
  body: InstanceSyncBody,
): { ok: boolean; written: number; unchanged: number; removed: number; epoch?: string; error?: string } {
  const root = session.mirrorRoot;
  if (!root) return { ok: false, written: 0, unchanged: 0, removed: 0, error: "mirror not ready" };

  let written = 0;
  let unchanged = 0;
  let removed = 0;

  for (const u of body.upserts ?? []) {
    if (!u?.service || !u?.name || typeof u.data !== "string") continue;
    const rel = unitRel(u.service, u.name);
    const abs = join(root, rel);
    const bytes = Buffer.from(u.data, "base64");
    const lp = longPath(abs);
    if (existsSync(lp)) {
      try {
        if (readFileSync(lp).equals(bytes)) {
          unchanged++;
          continue;
        }
      } catch {
        /* fall through and rewrite */
      }
    }
    const reason: HistoryReason = u.reason === "child-removed" ? "child-removed" : "edit";
    preserve(root, rel, u.studioPath, "instance", reason, bytes);
    markServerWrite(abs);
    try {
      mkdirSync(join(lp, ".."), { recursive: true });
      ensureWritable(abs);
      writeFileSync(lp, bytes);
      written++;
    } catch (e) {
      log(`[${session.placeName}] instance mirror write failed ${rel}: ${(e as Error).message}`);
    }
  }

  for (const r of body.removes ?? []) {
    if (!r?.studioPath || !r.studioPath.includes(".")) continue;
    const { service, name } = splitKey(r.studioPath);
    if (removeUnitFile(root, unitRel(service, name), r.studioPath, "removed")) {
      removed++;
      log(`[${session.placeName}] studio delete -> history: ${r.studioPath}`);
    }
  }

  // Manifest: unit files on disk that Studio no longer has (removed while the
  // plugin was off). Only ever looks at <Service>/*.rbxm, never script files.
  // An empty manifest is treated as a glitch and ignored.
  if (Array.isArray(body.manifest) && body.manifest.length > 0 && Array.isArray(body.services)) {
    const live = new Set(body.manifest.map((k) => {
      const { service, name } = splitKey(k);
      return unitRel(service, name);
    }));
    for (const svc of body.services) {
      const dir = longPath(join(root, sanitizeSegment(svc)));
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(INSTANCE_EXT)) continue;
        const rel = `${sanitizeSegment(svc)}/${f}`;
        if (live.has(rel)) continue;
        const studioPath = `${svc}.${f.slice(0, -INSTANCE_EXT.length)}`;
        if (removeUnitFile(root, rel, studioPath, "missing-at-connect")) {
          removed++;
          log(`[${session.placeName}] gone from Studio since last session -> history: ${studioPath}`);
        }
      }
    }
  }

  if (written || removed) {
    log(`[${session.placeName}] studio -> file: instances (${written} saved, ${removed} removed, ${unchanged} unchanged)`);
  }
  return { ok: true, written, unchanged, removed, epoch: epochFor(root) };
}

// ---- restore lookup ---------------------------------------------------------------

export interface RestoreCandidate {
  source: "mirror" | "history";
  kind: "rbxm" | "script";
  file: string; // absolute
  studioPath: string; // what the file holds (a unit, or the script itself)
  service: string;
  unitName: string;
  subPath: string; // wanted path below the unit ("" = the unit itself)
  stamp?: string;
  reason?: string;
  t?: number;
  className?: string;
}

const SCRIPT_CLASS: { suffix: string; className: string }[] = [
  { suffix: ".server.lua", className: "Script" },
  { suffix: ".server.luau", className: "Script" },
  { suffix: ".client.lua", className: "LocalScript" },
  { suffix: ".client.luau", className: "LocalScript" },
  { suffix: ".lua", className: "ModuleScript" },
  { suffix: ".luau", className: "ModuleScript" },
];

/** Does unit path `unit` contain (or equal) `wanted`? Returns the sub path. */
function subPathOf(wanted: string, unit: string): string | null {
  if (wanted === unit) return "";
  if (wanted.startsWith(unit + ".")) return wanted.slice(unit.length + 1);
  return null;
}

/** Files that may hold `studioPath`, best first: the live mirror unit, then
 *  history copies of the unit newest first, then script copies of the exact
 *  path. `version` = a history stamp, or "current" for the live mirror only. */
export function restoreCandidates(root: string, studioPath: string, version?: string): RestoreCandidate[] {
  const wanted = studioPath.replace(/^game\./i, "");
  const dot = wanted.indexOf(".");
  if (dot < 0) return [];
  const service = wanted.slice(0, dot);
  const out: RestoreCandidate[] = [];

  if (!version || version === "current") {
    const dir = longPath(join(root, sanitizeSegment(service)));
    if (existsSync(dir)) {
      let best: { name: string; sub: string } | null = null;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(INSTANCE_EXT)) continue;
        const name = f.slice(0, -INSTANCE_EXT.length);
        const sub = subPathOf(wanted, `${service}.${name}`);
        if (sub !== null && (!best || name.length > best.name.length)) best = { name, sub };
      }
      if (best) {
        out.push({
          source: "mirror",
          kind: "rbxm",
          file: join(root, unitRel(service, best.name)),
          studioPath: `${service}.${best.name}`,
          service,
          unitName: best.name,
          subPath: best.sub,
        });
      }
    }
    if (version === "current") return out;
  }

  const entries: HistoryEntry[] = readHistory(root)
    .filter((e) => !version || e.stamp === version)
    .sort((a, b) => b.t - a.t);
  for (const e of entries) {
    if (e.kind === "instance") {
      const sub = subPathOf(wanted, e.studioPath);
      if (sub === null) continue;
      const { name } = splitKey(e.studioPath);
      out.push({
        source: "history",
        kind: "rbxm",
        file: historyFile(root, e),
        studioPath: e.studioPath,
        service,
        unitName: name,
        subPath: sub,
        stamp: e.stamp,
        reason: e.reason,
        t: e.t,
      });
    } else if (e.studioPath === wanted) {
      const cls = SCRIPT_CLASS.find((c) => e.rel.endsWith(c.suffix))?.className ?? "ModuleScript";
      out.push({
        source: "history",
        kind: "script",
        file: historyFile(root, e),
        studioPath: e.studioPath,
        service,
        unitName: "",
        subPath: "",
        stamp: e.stamp,
        reason: e.reason,
        t: e.t,
        className: cls,
      });
    }
  }
  return out;
}

/** Live mirror units, for listing. */
export function listMirrorUnits(root: string): { studioPath: string; rel: string; bytes: number; mtime: number }[] {
  const out: { studioPath: string; rel: string; bytes: number; mtime: number }[] = [];
  const top = longPath(root);
  if (!existsSync(top)) return out;
  for (const svc of readdirSync(top, { withFileTypes: true })) {
    if (!svc.isDirectory() || svc.name.startsWith(".")) continue;
    const dir = join(top, svc.name);
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith(INSTANCE_EXT)) continue;
      try {
        const st = statSync(join(dir, f.name));
        out.push({
          studioPath: `${svc.name}.${f.name.slice(0, -INSTANCE_EXT.length)}`,
          rel: `${svc.name}/${f.name}`,
          bytes: st.size,
          mtime: st.mtimeMs,
        });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}
