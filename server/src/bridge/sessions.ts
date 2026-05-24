// Per-place session registry + command routing. Replaces the old global queue:
// every connected Studio place gets its own command queue, waiters, and pending
// map, so commands route to a specific place by PlaceId.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Command } from "./protocol.js";
import { Project } from "../sync/project.js";
import { resolveProjectForPlace, getPlaceIdByName, validatedBase } from "../registry.js";
import { log } from "../util/log.js";

/** Local mirror folder for a published place: <base>/projects/<name>_<placeId>. */
function mirrorRootFor(placeId: number, placeName: string): string | undefined {
  if (!placeId || placeId === 0) return undefined; // only published places
  const safe = placeName.replace(/[^A-Za-z0-9_-]/g, "_") || "Place";
  return join(validatedBase(), "projects", `${safe}_${placeId}`);
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}
type Waiter = (cmd: Command | null) => void;

export interface Session {
  sessionId: string;
  placeId: number;
  gameId?: number;
  placeName: string;
  root: string;
  mirrorRoot?: string; // <base>/projects/<name>_<placeId> for published places
  project: Project | null;
  queue: Command[];
  waiters: Waiter[];
  pending: Map<string, Pending>;
  lastSeen: number;
  connected: boolean;
}

const sessionsById = new Map<string, Session>();
const placeToSession = new Map<number, string>(); // placeId -> latest sessionId

export interface ReadyInfo {
  sessionId: string;
  placeId: number;
  gameId?: number;
  placeName: string;
}

export type OnSessionConnect = (s: Session) => void;
let onConnect: OnSessionConnect | null = null;
export function setOnSessionConnect(fn: OnSessionConnect) {
  onConnect = fn;
}

export function onReady(info: ReadyInfo): Session {
  const entry = resolveProjectForPlace(info.placeId, info.placeName, info.gameId);
  let project: Project | null = null;
  try {
    project = Project.load(entry.root);
  } catch (e) {
    log(`project load failed for ${entry.root}: ${(e as Error).message}`);
  }

  const existing = sessionsById.get(info.sessionId);
  const session: Session = existing ?? {
    sessionId: info.sessionId,
    placeId: info.placeId,
    gameId: info.gameId,
    placeName: info.placeName,
    root: entry.root,
    mirrorRoot: mirrorRootFor(info.placeId, info.placeName),
    project,
    queue: [],
    waiters: [],
    pending: new Map(),
    lastSeen: Date.now(),
    connected: true,
  };
  session.placeId = info.placeId;
  session.gameId = info.gameId;
  session.placeName = info.placeName;
  session.root = entry.root;
  session.mirrorRoot = mirrorRootFor(info.placeId, info.placeName);
  session.project = project;
  session.lastSeen = Date.now();
  session.connected = true;

  sessionsById.set(info.sessionId, session);
  placeToSession.set(info.placeId, info.sessionId);

  log(`session ${info.sessionId.slice(0, 8)} -> place ${info.placeId} "${info.placeName}" root ${entry.root}`);
  if (onConnect && !existing) onConnect(session);
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return sessionsById.get(sessionId);
}

export function getSessionByPlace(placeId: number): Session | undefined {
  const sid = placeToSession.get(placeId);
  return sid ? sessionsById.get(sid) : undefined;
}

export function touch(sessionId: string) {
  const s = sessionsById.get(sessionId);
  if (s) s.lastSeen = Date.now();
}

export function listSessions(): Session[] {
  return [...sessionsById.values()];
}

/** Detect connect/disconnect transitions (no poll within staleMs = disconnected). */
export function startHeartbeat(
  hooks: { onDisconnect?: (s: Session) => void; onReconnect?: (s: Session) => void },
  staleMs = 15_000,
) {
  setInterval(() => {
    const now = Date.now();
    for (const s of sessionsById.values()) {
      const alive = now - s.lastSeen < staleMs;
      if (s.connected && !alive) {
        s.connected = false;
        hooks.onDisconnect?.(s);
      } else if (!s.connected && alive) {
        s.connected = true;
        hooks.onReconnect?.(s);
      }
    }
  }, 5_000);
}

export function listPlaces() {
  return [...sessionsById.values()].map((s) => ({
    placeId: s.placeId,
    name: s.placeName,
    gameId: s.gameId,
    root: s.root,
    sessionId: s.sessionId,
    lastSeen: s.lastSeen,
  }));
}

/** The default target place for a tool with no explicit `place`. */
export function defaultPlaceId(): number | null {
  const primary = process.env.TUFAN_PROJECT;
  if (primary) {
    for (const s of sessionsById.values()) {
      if (s.root.replace(/[\\/]+$/, "") === primary.replace(/[\\/]+$/, "")) return s.placeId;
    }
  }
  const all = [...sessionsById.values()];
  if (all.length === 1) return all[0].placeId;
  return null;
}

/** Resolve a tool's optional `place` (placeId number, or project name) to a placeId. */
export function resolveTargetPlace(place?: string | number): { placeId?: number; error?: string } {
  if (place === undefined || place === null || place === "") {
    const def = defaultPlaceId();
    if (def === null) {
      const places = listPlaces();
      if (places.length === 0) return { error: "No Studio place is connected. Open your place in Studio with the Tufan plugin." };
      return { error: `Multiple places connected; specify "place". Connected: ${places.map((p) => `${p.name}(${p.placeId})`).join(", ")}` };
    }
    return { placeId: def };
  }
  // numeric placeId
  const asNum = typeof place === "number" ? place : Number(place);
  if (!Number.isNaN(asNum) && getSessionByPlace(asNum)) return { placeId: asNum };
  // by name
  const sid = getPlaceIdByName(String(place));
  if (sid && getSessionByPlace(Number(sid))) return { placeId: Number(sid) };
  // name among connected sessions
  for (const s of sessionsById.values()) {
    if (s.placeName.toLowerCase() === String(place).toLowerCase()) return { placeId: s.placeId };
  }
  return { error: `Place "${place}" is not connected.` };
}

/** Send an op to a specific place and await its result. */
export function dispatchTo(
  placeId: number,
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const session = getSessionByPlace(placeId);
  if (!session) {
    return Promise.reject(new Error(`Place ${placeId} is not connected.`));
  }
  const id = randomUUID();
  const cmd: Command = { id, op, args };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`Plugin (place ${placeId}) did not respond to "${op}" within ${timeoutMs}ms.`));
    }, timeoutMs);
    session.pending.set(id, { resolve, reject, timer });
    const waiter = session.waiters.shift();
    if (waiter) waiter(cmd);
    else session.queue.push(cmd);
  });
}

export function nextCommandFor(sessionId: string, holdMs = 25_000): Promise<Command | null> {
  const session = sessionsById.get(sessionId);
  if (!session) return Promise.resolve(null);
  const queued = session.queue.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => {
    const waiter: Waiter = (cmd) => {
      clearTimeout(timer);
      resolve(cmd);
    };
    const timer = setTimeout(() => {
      const i = session.waiters.indexOf(waiter);
      if (i >= 0) session.waiters.splice(i, 1);
      resolve(null);
    }, holdMs);
    session.waiters.push(waiter);
  });
}

export function resolveResponse(sessionId: string | undefined, id: string, ok: boolean, result?: unknown, error?: string) {
  // Try the named session first, then scan all sessions — command ids are
  // globally-unique UUIDs, so this is safe and tolerates a missing/stale
  // sessionId on the response (e.g. just after a plugin reconnect).
  let session = sessionId ? sessionsById.get(sessionId) : undefined;
  if (!session || !session.pending.has(id)) {
    session = undefined;
    for (const s of sessionsById.values()) {
      if (s.pending.has(id)) {
        session = s;
        break;
      }
    }
  }
  if (!session) return;
  const p = session.pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  session.pending.delete(id);
  if (ok) p.resolve(result);
  else p.reject(new Error(error ?? "Plugin reported an unknown error"));
}
