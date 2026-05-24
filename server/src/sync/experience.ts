// Resolve an Experience (Universe) name from its UniverseId via the public
// games API. The plugin can't reach roblox.com (HttpService is blocked from
// Roblox domains), so this runs server-side. Cached.

import { log } from "../util/log.js";

const cache = new Map<number, string | null>();

/** Returns the experience name, or null if the public games API has none
 *  (e.g. a private/unpublished game) — caller falls back to the place name. */
export async function resolveExperienceName(universeId?: number): Promise<string | null> {
  if (!universeId || universeId === 0) return null;
  if (cache.has(universeId)) return cache.get(universeId)!;

  let name: string | null = null;
  try {
    const r = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`, {
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const j: any = await r.json();
      const n = j?.data?.[0]?.name;
      if (n) name = n;
    }
  } catch (e) {
    log(`experience name lookup failed for ${universeId}: ${(e as Error).message}`);
  }
  cache.set(universeId, name);
  return name;
}
