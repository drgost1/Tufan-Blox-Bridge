// Per-place error/warning feed. The plugin pushes errors+warnings here as they
// stream (POST /studio-event); `get_recent_errors` reads from this buffer with
// ZERO Studio round-trip, so the debug loop closes instantly — even while the
// plugin VM is busy inside a playtest.

export interface FeedEvent {
  seq: number;
  sev: string; // "error" | "warning"
  msg: string;
  ts: number;
  script?: string; // parsed from "Path.Script:42: ..." when present
  line?: number;
}

const MAX = 500;
const feeds = new Map<number, FeedEvent[]>();
const seqByPlace = new Map<number, number>();

// Roblox prints errors as "Workspace.Foo.Script:42: message" (sometimes with a
// leading source tag). Pull out script + line so the AI can jump straight there.
function parseScriptLine(msg: string): { script?: string; line?: number } {
  const m = msg.match(/([\w.]+):(\d+):/);
  if (m) return { script: m[1], line: Number(m[2]) };
  return {};
}

export function pushEvents(placeId: number, events: { sev: string; msg: string; ts?: number }[]) {
  let arr = feeds.get(placeId);
  if (!arr) {
    arr = [];
    feeds.set(placeId, arr);
  }
  let seq = seqByPlace.get(placeId) ?? 0;
  for (const e of events) {
    if (!e || typeof e.msg !== "string") continue;
    seq += 1;
    arr.push({ seq, sev: e.sev ?? "error", msg: e.msg, ts: e.ts ?? Date.now(), ...parseScriptLine(e.msg) });
  }
  seqByPlace.set(placeId, seq);
  if (arr.length > MAX) arr.splice(0, arr.length - MAX);
}

export function readEvents(placeId: number, opts: { since?: number; severity?: string } = {}): { events: FeedEvent[]; cursor: number } {
  const arr = feeds.get(placeId) ?? [];
  const since = opts.since ?? 0;
  const events = arr.filter((e) => e.seq > since && (!opts.severity || e.sev === opts.severity));
  return { events, cursor: seqByPlace.get(placeId) ?? 0 };
}

export function clearFeed(placeId: number) {
  feeds.delete(placeId);
  // keep the seq monotonic so a stale `since` cursor never re-reads old events
}
