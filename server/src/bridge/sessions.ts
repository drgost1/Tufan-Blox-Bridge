// Per-place session registry + command routing. Replaces the old global queue:
// every connected Studio place gets its own command queue, waiters, and pending
// map, so commands route to a specific place by PlaceId.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Command } from "./protocol.js";
import { Project } from "../sync/project.js";
import { resolveProjectForPlace, getPlaceIdByName, validatedBase } from "../registry.js";
import { log } from "../util/log.js";

/** Filesystem-safe, readable folder label. */
export function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Place";
}

/** Experience-grouped, per-place mirror folder:
 *  <base>/projects/<Experience>_<universeId>/<Place>_<placeId>/ */
export function experienceMirrorRoot(
  expName: string,
  universeId: number | undefined,
  placeName: string,
  placeId: number,
): string {
  const exp = `${sanitizeName(expName)}_${universeId ?? "0"}`;
  const place = `${sanitizeName(placeName)}_${placeId}`;
  return join(validatedBase(), "projects", exp, place);
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

// ── Proxy mode ──────────────────────────────────────────────────────────────
// When another Tufan server already owns the bridge + plugin (a concurrent Claude
// session), this server runs as a PROXY: it forwards dispatch to the owner and
// reads the place list from the owner (cached). All sessions then share the one
// plugin, and the owner serializes every command through the single plugin queue
// → multiple sessions, no collisions. proxyOwner=null means we're the owner.
type PlaceSummary = {
  sessionId: string;
  placeId: number;
  gameId?: number;
  placeName: string;
  root: string;
  mirrorRoot?: string;
  lastSeen: number;
};
let proxyOwner: string | null = null;
let proxyPlaces: PlaceSummary[] = [];
let proxyPoll: NodeJS.Timeout | null = null;

export function setProxyMode(ownerUrl: string | null) {
  proxyOwner = ownerUrl;
  if (proxyPoll) {
    clearInterval(proxyPoll);
    proxyPoll = null;
  }
  if (ownerUrl) {
    const refresh = async () => {
      try {
        const r: any = await fetch(`${ownerUrl}/proxy/places`, { signal: AbortSignal.timeout(2500) }).then((x) => x.json());
        if (Array.isArray(r?.places)) proxyPlaces = r.places;
      } catch {
        /* owner unreachable — keep last list; the bind-retry promotes us if it died */
      }
    };
    void refresh();
    // Poll fast enough that a place freshly connected to the owner becomes visible
    // to this proxy within a fraction of a second (else resolveTargetPlace would
    // spuriously report "not connected" for up to a full interval). 750ms keeps
    // that window small without hammering the owner.
    proxyPoll = setInterval(refresh, 750);
  } else {
    proxyPlaces = [];
  }
}

export function isProxy(): boolean {
  return proxyOwner !== null;
}

// Unified place list: the owner's live sessions, or (in proxy mode) the cache.
function allPlaces(): PlaceSummary[] {
  if (proxyOwner) return proxyPlaces;
  return [...sessionsById.values()].map((s) => ({
    sessionId: s.sessionId,
    placeId: s.placeId,
    gameId: s.gameId,
    placeName: s.placeName,
    root: s.root,
    mirrorRoot: s.mirrorRoot,
    lastSeen: s.lastSeen,
  }));
}

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
    mirrorRoot: undefined, // set by the connect handler once the experience name resolves
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
  if (proxyOwner) {
    // proxy: a cached summary is enough for what tools read (placeId, mirrorRoot, root, name)
    const p = proxyPlaces.find((x) => x.placeId === placeId);
    return p ? (p as unknown as Session) : undefined;
  }
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
      // A session with an in-flight command is busy executing a heavy op — the
      // plugin VM is single-threaded, so it can't poll mid-op. That's "busy",
      // not "dead". Treat pending work as alive to avoid a false disconnect
      // ("No Studio place is connected") during a long mass-edit / run_luau.
      const alive = now - s.lastSeen < staleMs || s.pending.size > 0;
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
  return allPlaces().map((s) => ({
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
  const all = allPlaces();
  const primary = process.env.TUFAN_PROJECT;
  if (primary) {
    for (const s of all) {
      if (s.root.replace(/[\\/]+$/, "") === primary.replace(/[\\/]+$/, "")) return s.placeId;
    }
  }
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
  for (const s of allPlaces()) {
    if (s.placeName.toLowerCase() === String(place).toLowerCase()) return { placeId: s.placeId };
  }
  return { error: `Place "${place}" is not connected.` };
}

/** Send an op to a specific place and await its result. */
// Default command timeout. Generous because a legitimately heavy op (mass edit
// over thousands of parts, a big run_luau loop) can take well over 30s and the
// plugin can only POST /response once it finishes. A per-tool call can still
// override via the timeoutMs arg. Combined with the pending-aware heartbeat
// above, a slow op no longer false-disconnects OR prematurely errors.
const DEFAULT_TIMEOUT_MS = 90_000;

export function dispatchTo(
  placeId: number,
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  // Proxy mode: forward to the owner, which runs it through the single plugin
  // queue (serialized with every other session's commands → no collisions).
  if (proxyOwner) {
    return fetch(`${proxyOwner}/proxy/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId, op, args, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 5000),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; result?: unknown; error?: string }>)
      .then((j) => {
        if (j.ok) return j.result;
        throw new Error(j.error ?? "proxy dispatch failed");
      });
  }
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
