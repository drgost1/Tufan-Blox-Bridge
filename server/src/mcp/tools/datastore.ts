import { z } from "zod";
import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, requireWritable, placeArg } from "../helpers.js";
import { scrub, ocApiKey, resolveUniverse } from "../../openCloud.js";

// Open Cloud DataStore REST tool — inspect/edit a PUBLISHED game's saved data
// from the server side (no Studio runtime). Built on the fully-documented v1
// surface. Read-first: writes are gated by requireWritable() + an explicit
// confirm flag because the REST path does NOT respect ProfileStore session locks.

const DS_BASE = "https://apis.roblox.com/datastores/v1";
const ODS_BASE = "https://apis.roblox.com/ordered-data-stores/v1";
const MAX_BODY = 100_000; // cap a returned value/list so a 4MB entry can't flood context

const DS_KEY_HELP =
  "datastore needs a Roblox Open Cloud API key WITH DataStore scopes:\n" +
  "  1. https://create.roblox.com/dashboard/credentials → your key (the same one the asset tools use, or a new one)\n" +
  '  2. Add the "universe-datastores" API system — reads: objects:read + objects:list + control:list; ' +
  "writes also: objects:create, objects:update, objects:delete. (Ordered datastores use the separate " +
  '"ordered-data-store" scopes.)\n' +
  "  3. Under Access Permissions, add THIS experience — a key only works for universes on its access list.\n" +
  "  4. Set TUFAN_OPENCLOUD_KEY=<key> in the tufan MCP server env.\n" +
  "universeId is auto-detected from game.GameId; override with TUFAN_UNIVERSE_ID.";

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== false) p.append(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function capBody(s: string): string {
  return s.length > MAX_BODY ? `${s.slice(0, MAX_BODY)}\n…(truncated at ${MAX_BODY} of ${s.length} chars — narrow with a key/cursor)` : s;
}

type OC = { status: number; ok: boolean; body: string; headers: Headers };
async function ocFetch(url: string, key: string, init: RequestInit = {}): Promise<OC> {
  const res = await fetch(url, {
    ...init,
    headers: { "x-api-key": key, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, ok: res.ok, body: await res.text(), headers: res.headers };
}

function mapError(oc: OC, key: string): string {
  const b = scrub(oc.body.slice(0, 400), key);
  if (oc.status === 401) return `HTTP 401 — Open Cloud API key invalid.\n${DS_KEY_HELP}`;
  if (oc.status === 403)
    return (
      `HTTP 403 — the key lacks the required DataStore scope, OR this universe isn't on the key's access ` +
      `list (or an IP allowlist blocked it).\n${b}\n\n${DS_KEY_HELP}`
    );
  if (oc.status === 404) return `HTTP 404 — datastore/entry not found.\n${b}`;
  if (oc.status === 429) return `HTTP 429 — rate limited (Open Cloud allows ~300 req/min/universe). Back off and retry.\n${b}`;
  return `HTTP ${oc.status}: ${b}`;
}

export function registerDataStoreTools(server: McpServer) {
  // Mixed read/write: reads stay available in read-only mode; the write actions
  // (set/delete/increment) are gated at call time via requireWritable() + confirm.
  server.registerTool(
    "datastore",
    {
      description:
        "Inspect/edit a PUBLISHED game's saved data via the Open Cloud DataStore API (server-side HTTP, no " +
        "Studio runtime). READ actions: list_datastores, list_keys, get, list_ordered, get_ordered. WRITE " +
        "actions (gated — need confirm:true and are blocked in read-only mode): set, delete, increment. " +
        "⚠ SESSION-LOCK WARNING: a live game server owns the keys of ONLINE players (ProfileStore session " +
        "lock); the REST write path ignores that lock, so writing such a key either gets overwritten by the " +
        "server's autosave or corrupts the live session. Only write keys for OFFLINE players. Needs an Open " +
        "Cloud key with universe-datastores scopes (TUFAN_OPENCLOUD_KEY) and a published universe " +
        "(auto-detected from game.GameId, or TUFAN_UNIVERSE_ID).",
      inputSchema: {
        action: z.enum([
          "list_datastores",
          "list_keys",
          "get",
          "set",
          "delete",
          "increment",
          "list_ordered",
          "get_ordered",
        ]),
        datastoreName: z.string().optional().describe("the DataStore name (required for standard entry actions)"),
        entryKey: z.string().optional().describe("the entry key (required for get/set/delete/increment/get_ordered)"),
        scope: z.string().optional().describe('DataStore scope (default "global")'),
        value: z.any().optional().describe("the JSON value to store (set)"),
        incrementBy: z.number().optional().describe("amount to add (increment)"),
        orderedDataStore: z.string().optional().describe("ordered datastore name (list_ordered / get_ordered)"),
        order: z.enum(["asc", "desc"]).optional().describe("sort for list_ordered (default asc; desc = top-first leaderboard)"),
        prefix: z.string().optional().describe("name/key prefix filter (list actions)"),
        cursor: z.string().optional().describe("pagination cursor / page token from a previous call"),
        limit: z.number().optional().describe("max results per page"),
        allScopes: z.boolean().optional().describe("list keys across all scopes (list_keys) — mutually exclusive with scope"),
        userIds: z.array(z.number()).optional().describe("associated user ids to tag on the entry (set)"),
        attributes: z.record(z.any()).optional().describe("entry metadata (set)"),
        matchVersion: z.string().optional().describe("only write if the current version matches (set)"),
        exclusiveCreate: z.boolean().optional().describe("only create if the key doesn't exist yet (set)"),
        confirm: z
          .boolean()
          .optional()
          .describe("REQUIRED for write actions (set/delete/increment) — acknowledges the session-lock risk"),
        place: placeArg,
      },
    },
    async (a) => {
      const WRITES = new Set(["set", "delete", "increment"]);
      if (WRITES.has(a.action)) {
        const ro = requireWritable();
        if (ro) return ro;
        if (!a.confirm) {
          return errorText(
            `'${a.action}' writes live save data. Re-call with confirm:true.\n` +
              `⚠ Only write keys for OFFLINE players — writing a key a live server currently owns (ProfileStore ` +
              `session lock) will be overwritten by its autosave OR will corrupt the live session.`,
          );
        }
      }

      const key = ocApiKey();
      if (!key) return errorText(DS_KEY_HELP);
      const uni = await resolveUniverse(a.place);
      if (uni.error) return errorText(uni.error);
      const u = uni.universeId!;
      const scope = a.scope ?? "global";

      try {
        switch (a.action) {
          case "list_datastores": {
            const url = `${DS_BASE}/universes/${u}/standard-datastores` + qs({ prefix: a.prefix, cursor: a.cursor, limit: a.limit });
            const oc = await ocFetch(url, key);
            return oc.ok ? text(capBody(oc.body)) : errorText(mapError(oc, key));
          }
          case "list_keys": {
            if (!a.datastoreName) return errorText("list_keys needs datastoreName");
            // scope and allScopes are mutually exclusive — omit scope when listing all scopes.
            const url =
              `${DS_BASE}/universes/${u}/standard-datastores/datastore/entries` +
              qs({
                datastoreName: a.datastoreName,
                scope: a.allScopes ? undefined : scope,
                allScopes: a.allScopes,
                prefix: a.prefix,
                cursor: a.cursor,
                limit: a.limit,
              });
            const oc = await ocFetch(url, key);
            return oc.ok ? text(capBody(oc.body)) : errorText(mapError(oc, key));
          }
          case "get": {
            if (!a.datastoreName || !a.entryKey) return errorText("get needs datastoreName + entryKey");
            const url =
              `${DS_BASE}/universes/${u}/standard-datastores/datastore/entries/entry` +
              qs({ datastoreName: a.datastoreName, entryKey: a.entryKey, scope });
            const oc = await ocFetch(url, key);
            if (!oc.ok) return errorText(mapError(oc, key));
            const version = oc.headers.get("roblox-entry-version");
            const userIds = oc.headers.get("roblox-entry-userids");
            const meta = [version ? `version: ${version}` : "", userIds ? `userIds: ${userIds}` : ""].filter(Boolean).join("  ");
            return text((meta ? meta + "\n" : "") + capBody(oc.body));
          }
          case "set": {
            if (!a.datastoreName || !a.entryKey) return errorText("set needs datastoreName + entryKey");
            if (a.value === undefined) return errorText("set needs a value");
            if (a.matchVersion && a.exclusiveCreate) return errorText("matchVersion and exclusiveCreate are mutually exclusive");
            const body = JSON.stringify(a.value);
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              "content-md5": createHash("md5").update(body).digest("base64"),
            };
            if (a.userIds) headers["roblox-entry-userids"] = JSON.stringify(a.userIds);
            if (a.attributes) headers["roblox-entry-attributes"] = JSON.stringify(a.attributes);
            const url =
              `${DS_BASE}/universes/${u}/standard-datastores/datastore/entries/entry` +
              qs({ datastoreName: a.datastoreName, entryKey: a.entryKey, scope, matchVersion: a.matchVersion, exclusiveCreate: a.exclusiveCreate });
            const oc = await ocFetch(url, key, { method: "POST", headers, body });
            return oc.ok ? text(`✓ set ${a.datastoreName}/${a.entryKey} (scope ${scope})\n${capBody(oc.body)}`) : errorText(mapError(oc, key));
          }
          case "delete": {
            if (!a.datastoreName || !a.entryKey) return errorText("delete needs datastoreName + entryKey");
            const url =
              `${DS_BASE}/universes/${u}/standard-datastores/datastore/entries/entry` +
              qs({ datastoreName: a.datastoreName, entryKey: a.entryKey, scope });
            const oc = await ocFetch(url, key, { method: "DELETE" });
            return oc.ok ? text(`✓ deleted ${a.datastoreName}/${a.entryKey} (scope ${scope})`) : errorText(mapError(oc, key));
          }
          case "increment": {
            if (!a.datastoreName || !a.entryKey) return errorText("increment needs datastoreName + entryKey");
            if (a.incrementBy === undefined) return errorText("increment needs incrementBy");
            const url =
              `${DS_BASE}/universes/${u}/standard-datastores/datastore/entries/entry/increment` +
              qs({ datastoreName: a.datastoreName, entryKey: a.entryKey, incrementBy: a.incrementBy, scope });
            const oc = await ocFetch(url, key, { method: "POST" });
            return oc.ok ? text(`✓ incremented ${a.datastoreName}/${a.entryKey} by ${a.incrementBy}\n${capBody(oc.body)}`) : errorText(mapError(oc, key));
          }
          case "list_ordered": {
            if (!a.orderedDataStore) return errorText("list_ordered needs orderedDataStore");
            const url =
              `${ODS_BASE}/universes/${u}/orderedDataStores/${encodeURIComponent(a.orderedDataStore)}/scopes/${encodeURIComponent(scope)}/entries` +
              // order_by: omit for ascending (always valid); "desc" for top-first.
              qs({ max_page_size: a.limit, page_token: a.cursor, order_by: a.order === "desc" ? "desc" : undefined });
            const oc = await ocFetch(url, key);
            return oc.ok ? text(capBody(oc.body)) : errorText(mapError(oc, key));
          }
          case "get_ordered": {
            if (!a.orderedDataStore || !a.entryKey) return errorText("get_ordered needs orderedDataStore + entryKey");
            const url = `${ODS_BASE}/universes/${u}/orderedDataStores/${encodeURIComponent(a.orderedDataStore)}/scopes/${encodeURIComponent(scope)}/entries/${encodeURIComponent(a.entryKey)}`;
            const oc = await ocFetch(url, key);
            return oc.ok ? text(capBody(oc.body)) : errorText(mapError(oc, key));
          }
        }
      } catch (e) {
        return errorText(`datastore ${a.action} failed: ${scrub((e as Error).message, key)}`);
      }
      return errorText(`unknown action: ${a.action}`);
    },
  );
}
