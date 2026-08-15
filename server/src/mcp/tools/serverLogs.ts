import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { scrub, ocApiKey, resolveUniverse } from "../../openCloud.js";

// Open Cloud Server Management (BETA) — PRODUCTION game-server observability:
//   get_server_logs    → per-server error/warning logs + stack traces (Game Server Logs, June 2026)
//   get_server_history → active + terminated/crashed/OOM servers, rolling 30 days (Server History, July 2026)
// Both are READ tools (universe:read scope) — visible in read-only mode, not in WRITE_TOOLS.
// Confirmed against the official openapi.json in Roblox/creator-docs:
//   GET /server-management/v1/universes/{universeId}/places/{placeId}/versions/{versionNumber}/game-servers
//   GET /server-management/v1/universes/{universeId}/places/{placeId}/versions/{versionNumber}/game-servers/{jobId}/logs
// Rate limit (both): 100 req/min per API key owner (x-roblox-rate-limits in the spec).

const SM = "https://apis.roblox.com/server-management/v1";
const PVH = "https://apis.roblox.com/place-version-history-api/v1";
const MAX = 60_000;

// Creator-visible ServerStatus enum values from the spec (string form).
const TERMINATED = ["shut_down", "restarted", "roblox_restarted", "crashed", "out_of_memory", "moderated"];
// LogSeverity: Output (0), Info (1), Warning (2), Error (3).
const SEVERITY: Record<string, number> = { output: 0, info: 1, warning: 2, error: 3 };

const SM_KEY_HELP =
  "this tool needs a Roblox Open Cloud API key with server-management read access:\n" +
  "  1. https://create.roblox.com/dashboard/credentials → your key (the same one the asset/datastore tools use, or a new one)\n" +
  '  2. Add the "universe" API system with the read operation (universe:read — covers Server Management)\n' +
  '  3. To auto-resolve the current version (no `version` arg), also add "universe.place:read"\n' +
  "  4. Under Access Permissions add THIS experience — a key only works for universes on its access list\n" +
  "  5. Set TUFAN_OPENCLOUD_KEY=<key> in the tufan MCP server env.\n" +
  "universeId is auto-detected from game.GameId; override with TUFAN_UNIVERSE_ID.";

function cap(s: string): string {
  return s.length > MAX ? `${s.slice(0, MAX)}\n…(truncated)` : s;
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.append(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

type OC = { status: number; ok: boolean; body: string; json: any };
async function ocFetch(url: string, key: string): Promise<OC> {
  const res = await fetch(url, {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: res.ok, body, json };
}

function mapErr(oc: OC, key: string): string {
  const b = scrub(oc.body.slice(0, 400), key);
  if (oc.status === 401) return `HTTP 401 — Open Cloud API key invalid.\n${SM_KEY_HELP}`;
  if (oc.status === 403)
    return `HTTP 403 — the key lacks the universe read scope, or this universe isn't on the key's access list.\n${b}\n\n${SM_KEY_HELP}`;
  if (oc.status === 404)
    return `HTTP 404 — universe/place/version/server not found (check \`version\` and \`serverId\`).\n${b}`;
  if (oc.status === 429) return `HTTP 429 — rate limited (Server Management allows 100 req/min per API key). Back off and retry.\n${b}`;
  return `HTTP ${oc.status}: ${b}`;
}

/**
 * Resolve the {versionNumber} both Server Management endpoints take in their path:
 * the caller's explicit `version`, else the latest PUBLISHED place version via the
 * (experimental) place-version-history API — numeric max over the first page of
 * published versions.
 */
async function resolveVersion(
  key: string,
  placeId: number,
  version?: string,
): Promise<{ version?: string; error?: string }> {
  if (version) return { version };
  const oc = await ocFetch(`${PVH}/${placeId}/history?isPublished=true&pageSize=10`, key);
  if (!oc.ok) {
    return {
      error:
        `Couldn't auto-resolve the current place version (${oc.status}) — pass it explicitly with the \`version\` ` +
        `argument (find it in Creator Hub → Server Management), and make sure the key has universe.place:read.`,
    };
  }
  const nums = (oc.json?.placeVersions ?? [])
    .filter((v: any) => v?.isPublished)
    .map((v: any) => Number(v?.version))
    .filter((n: number) => Number.isFinite(n));
  if (!nums.length) return { error: "No published version found for this place — publish it first, or pass `version` explicitly." };
  return { version: String(Math.max(...nums)) };
}

function fmtServer(s: any): string {
  const mem = s.memoryUsageBytes ? `${(Number(s.memoryUsageBytes) / 1048576).toFixed(0)}MB` : "?";
  const occ = `${s.occupancy ?? "?"}/${s.maxOccupancy ?? "?"}`;
  const term = s.terminationTime ? ` terminated=${s.terminationTime}` : "";
  return `[${s.status ?? "?"}] job=${s.jobId ?? "?"} v=${s.placeVersion ?? "?"} up=${s.uptime ?? "?"} mem=${mem} fps=${s.frameRate ?? "?"} players=${occ} created=${s.createTime ?? "?"}${term}`;
}

async function listServers(
  key: string,
  u: string,
  p: number,
  v: string,
  filter: string | undefined,
  limit?: number,
  cursor?: string,
): Promise<OC> {
  const url =
    `${SM}/universes/${u}/places/${p}/versions/${encodeURIComponent(v)}/game-servers` +
    qs({ MaxPageSize: limit, PageToken: cursor, Filter: filter });
  return ocFetch(url, key);
}

export function registerServerLogTools(server: McpServer) {
  server.registerTool(
    "get_server_logs",
    {
      description:
        "Recent PRODUCTION game-server logs (errors/warnings with full stack traces) via the Open Cloud Server " +
        "Management API (Game Server Logs, BETA) — per-server visibility into your LIVE game, the same data as " +
        "Creator Hub → Server Management → Logs tab. Logs take ~3 min to appear after they're emitted. Pass " +
        "`serverId` (a jobId, same as game.JobId) to read one server's logs; omit it to list the currently " +
        "running servers so you can pick one (re-call with `serverId`). Server-emitted duplicates are aggregated " +
        "into skippedCount. Needs TUFAN_OPENCLOUD_KEY with the universe read scope. Siblings: get_output_log = " +
        "edit-mode Studio Output; get_recent_errors = live Studio session feed; this = PRODUCTION servers. " +
        "Pair with get_server_history to find terminated/crashed servers (logs stay readable after shutdown).",
      inputSchema: {
        serverId: z.string().optional().describe("jobId of the server to read logs from (omit to list running servers first)"),
        severity: z.enum(["error", "warning", "info", "output"]).optional().describe("only logs of this severity (server logs are currently errors/warnings only)"),
        limit: z.number().optional().describe("max log entries per page (default 25, max 100)"),
        cursor: z.string().optional().describe("PageToken from a previous call's nextPageToken"),
        version: z.string().optional().describe("place version number (default: latest published version, auto-resolved)"),
        filter: z.string().optional().describe("raw CEL filter override (e.g. 'severity >= 2'), replaces the severity filter"),
        place: placeArg,
      },
    },
    async ({ serverId, severity, limit, cursor, version, filter, place }) => {
      const key = ocApiKey();
      if (!key) return errorText(SM_KEY_HELP);
      try {
        const uni = await resolveUniverse(place);
        if (uni.error) return errorText(uni.error);
        if (!uni.placeId) return errorText("get_server_logs needs a connected place to resolve the placeId (or pass a PlaceId as `place`).");
        const v = await resolveVersion(key, uni.placeId, version);
        if (v.error) return errorText(v.error);

        // No serverId → list running servers so the caller can pick one.
        if (!serverId) {
          const oc = await listServers(key, uni.universeId!, uni.placeId, v.version!, 'server_status == "active"', limit);
          if (!oc.ok) return errorText(mapErr(oc, key));
          const servers = oc.json?.gameServers ?? [];
          if (!servers.length) return text(`(no active servers on version ${v.version})`);
          const lines = servers.map(fmtServer);
          return text(
            `${servers.length} active server(s) on place version ${v.version} — re-call with serverId:<jobId> to read its logs:\n` +
              lines.join("\n") +
              (oc.json?.nextPageToken ? `\n…more: nextPageToken=${oc.json.nextPageToken}` : ""),
          );
        }

        const cel = filter ?? (severity !== undefined ? `severity == ${SEVERITY[severity]}` : undefined);
        const url =
          `${SM}/universes/${uni.universeId}/places/${uni.placeId}/versions/${encodeURIComponent(v.version!)}/game-servers/${encodeURIComponent(serverId)}/logs` +
          qs({ MaxPageSize: limit, PageToken: cursor, Filter: cel });
        const oc = await ocFetch(url, key);
        if (!oc.ok) return errorText(mapErr(oc, key));
        const logs = oc.json?.gameServerLogs ?? [];
        if (!logs.length) return text(`(no logs for server ${serverId} — logs take ~3 min to populate)`);
        const sevName = ["OUTPUT", "INFO", "WARN", "ERROR"];
        const lines = logs.map((l: any) => {
          const agg =
            (l.skippedCount ? ` (×${l.skippedCount + 1} duplicates)` : "") +
            (l.rateLimitedCount ? ` (+${l.rateLimitedCount} rate-limited)` : "");
          let line = `${l.messageTimestampMs ?? "?"} [${sevName[Number(l.severity)] ?? l.severity}] ${l.message ?? ""}${agg}`;
          if (l.stackTrace) line += `\n    ${String(l.stackTrace).split("\n").join("\n    ")}`;
          if (l.messageTemplate || l.context) line += `\n    template=${l.messageTemplate ?? ""} context=${l.context ?? ""}`;
          return line;
        });
        return text(
          `${logs.length} log entr(ies) for server ${serverId} (version ${v.version}):\n` +
            cap(lines.join("\n")) +
            (oc.json?.nextPageToken ? `\n…more: re-call with cursor="${oc.json.nextPageToken}"` : ""),
        );
      } catch (e) {
        return errorText(`get_server_logs failed: ${scrub((e as Error).message, key)}`);
      }
    },
  );

  server.registerTool(
    "get_server_history",
    {
      description:
        "Server History for your PUBLISHED game via the Open Cloud Server Management API (BETA) — a rolling " +
        "30-day list of active AND terminated servers (shut down / restarted / crashed / out_of_memory / " +
        "moderated) with status, uptime, termination time, last-known memory/fps/occupancy. Default view is " +
        "terminated servers only; pass status:active for live servers or status:all for everything. This is the " +
        "same ListGameServers endpoint Creator Hub's Server Management page uses. Needs TUFAN_OPENCLOUD_KEY with " +
        "the universe read scope. Siblings: get_output_log = edit-mode Studio Output; get_recent_errors = live " +
        "Studio session feed; this = PRODUCTION servers. Follow up with get_server_logs serverId:<jobId> to read " +
        "a server's errors/stack traces (logs remain available after termination).",
      inputSchema: {
        status: z
          .enum(["terminated", "active", "all", "shut_down", "restarted", "roblox_restarted", "crashed", "out_of_memory", "moderated"])
          .optional()
          .describe('status filter: "terminated" (default) = every non-active status, "all" = no filter, or one specific status'),
        limit: z.number().optional().describe("max servers per page (default 25, max 100)"),
        cursor: z.string().optional().describe("PageToken from a previous call's nextPageToken"),
        orderBy: z.string().optional().describe('sort field, e.g. "uptime" or "uptime desc" (single field)'),
        version: z.string().optional().describe("place version number (default: latest published version, auto-resolved)"),
        filter: z.string().optional().describe("raw CEL filter override, replaces the status filter"),
        place: placeArg,
      },
    },
    async ({ status, limit, cursor, orderBy, version, filter, place }) => {
      const key = ocApiKey();
      if (!key) return errorText(SM_KEY_HELP);
      try {
        const uni = await resolveUniverse(place);
        if (uni.error) return errorText(uni.error);
        if (!uni.placeId) return errorText("get_server_history needs a connected place to resolve the placeId (or pass a PlaceId as `place`).");
        const v = await resolveVersion(key, uni.placeId, version);
        if (v.error) return errorText(v.error);

        const s = status ?? "terminated";
        const cel =
          filter ??
          (s === "all"
            ? undefined
            : s === "terminated"
              ? `server_status in [${TERMINATED.map((t) => `"${t}"`).join(", ")}]`
              : `server_status == "${s}"`);
        const url =
          `${SM}/universes/${uni.universeId}/places/${uni.placeId}/versions/${encodeURIComponent(v.version!)}/game-servers` +
          qs({ MaxPageSize: limit, PageToken: cursor, OrderBy: orderBy, Filter: cel });
        const oc = await ocFetch(url, key);
        if (!oc.ok) return errorText(mapErr(oc, key));
        const servers = oc.json?.gameServers ?? [];
        const total = oc.json?.totalCount !== undefined ? ` of ~${oc.json.totalCount}` : "";
        if (!servers.length) return text(`(no servers matching "${s}" on version ${v.version} — history covers the last 30 days)`);
        const lines = servers.map(fmtServer);
        return text(
          `${servers.length}${total} server(s) matching "${s}" on place version ${v.version} (30-day window):\n` +
            lines.join("\n") +
            (oc.json?.nextPageToken ? `\n…more: re-call with cursor="${oc.json.nextPageToken}"` : "") +
            `\nTip: get_server_logs serverId:<jobId> reads a server's error/warning logs (incl. after shutdown).`,
        );
      } catch (e) {
        return errorText(`get_server_history failed: ${scrub((e as Error).message, key)}`);
      }
    },
  );
}
