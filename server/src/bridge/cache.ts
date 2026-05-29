// Tiny per-place read cache. Repeat reads of the same subtree (get_descendants /
// get_tree) return instantly from here instead of a Studio round-trip. Two-layer
// invalidation: a short TTL covers manual edits in Studio; bumpPlace() clears the
// place immediately whenever the AI writes through the bridge (see helpers.ts).

interface Entry {
  value: string;
  ts: number;
}

const byPlace = new Map<number, Map<string, Entry>>();

// Hard cap per place so a long read-only inspection run (many distinct-arg reads,
// no intervening write to clear the place) can't grow the map unbounded. Evicts
// the oldest entry on overflow.
const MAX_ENTRIES_PER_PLACE = 256;

export function cacheGet(placeId: number, key: string, ttlMs: number): string | undefined {
  const m = byPlace.get(placeId);
  const e = m?.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > ttlMs) {
    m!.delete(key);
    return undefined;
  }
  return e.value;
}

export function cacheSet(placeId: number, key: string, value: string) {
  let m = byPlace.get(placeId);
  if (!m) {
    m = new Map();
    byPlace.set(placeId, m);
  }
  // Evict the oldest entry if at capacity (and we're inserting a new key).
  if (m.size >= MAX_ENTRIES_PER_PLACE && !m.has(key)) {
    let oldestKey: string | undefined;
    let oldestTs = Infinity;
    for (const [k, e] of m) {
      if (e.ts < oldestTs) {
        oldestTs = e.ts;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) m.delete(oldestKey);
  }
  m.set(key, { value, ts: Date.now() });
}

/** Any write through the bridge clears that place's read cache. */
export function bumpPlace(placeId: number) {
  byPlace.delete(placeId);
}
