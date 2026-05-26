// Tiny per-place read cache. Repeat reads of the same subtree (get_descendants /
// get_tree) return instantly from here instead of a Studio round-trip. Two-layer
// invalidation: a short TTL covers manual edits in Studio; bumpPlace() clears the
// place immediately whenever the AI writes through the bridge (see helpers.ts).

interface Entry {
  value: string;
  ts: number;
}

const byPlace = new Map<number, Map<string, Entry>>();

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
  m.set(key, { value, ts: Date.now() });
}

/** Any write through the bridge clears that place's read cache. */
export function bumpPlace(placeId: number) {
  byPlace.delete(placeId);
}
