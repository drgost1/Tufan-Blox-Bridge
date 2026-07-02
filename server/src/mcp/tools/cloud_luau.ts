import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { scrub, ocApiKey, resolveUniverse } from "../../openCloud.js";

// Open Cloud Luau Execution — run server-side Luau against the PUBLISHED game on a
// fresh ephemeral server. create task -> poll `state` -> read output.results /
// error -> fetch /logs. Write tool (real cloud side effects possible via
// DataStore/HttpService/SavePlaceAsync), so it's hidden in read-only mode.

const V2 = "https://apis.roblox.com/cloud/v2";
const MAX = 60_000;

const CLOUD_LUAU_HELP =
  "cloud_luau needs a Roblox Open Cloud API key with the Luau-execution scope:\n" +
  "  1. https://create.roblox.com/dashboard/credentials → your key\n" +
  '  2. Add the "universe.place.luau-execution-session" API system with read + write\n' +
  "  3. Under Access Permissions add THIS experience\n" +
  "  4. Set TUFAN_OPENCLOUD_KEY=<key> in the tufan MCP server env.";

function cap(s: string): string {
  return s.length > MAX ? `${s.slice(0, MAX)}\n…(truncated)` : s;
}

type OC = { status: number; ok: boolean; body: string; json: any };
async function ocFetch(url: string, key: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<OC> {
  const res = await fetch(url, {
    ...init,
    headers: { "x-api-key": key, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
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
  if (oc.status === 401) return `HTTP 401 — Open Cloud API key invalid.\n${CLOUD_LUAU_HELP}`;
  if (oc.status === 403)
    return `HTTP 403 — the key lacks the luau-execution scope, or this universe isn't on the key's access list.\n${b}\n\n${CLOUD_LUAU_HELP}`;
  if (oc.status === 404) return `HTTP 404 — universe/place/task not found.\n${b}`;
  if (oc.status === 429)
    return `HTTP 429 — rate/quota limited (~5 creates/min, max 10 incomplete tasks/place). Back off and retry.\n${b}`;
  return `HTTP ${oc.status}: ${b}`;
}

// Logs live at the task path + "/logs" (FLAT view = plain message strings).
async function fetchLogs(taskPath: string, key: string): Promise<string> {
  try {
    const res = await fetch(`${V2}/${taskPath}/logs?view=FLAT&maxPageSize=100`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return "";
    const j: any = await res.json();
    const msgs: string[] = [];
    for (const e of j?.luauExecutionSessionTaskLogs ?? []) for (const m of e?.messages ?? []) msgs.push(String(m));
    return msgs.join("\n");
  } catch {
    return "";
  }
}

export function registerCloudLuauTools(server: McpServer) {
  server.registerTool(
    "cloud_luau",
    {
      description:
        "Run server-side Luau against your PUBLISHED game via the Open Cloud Luau Execution API — a fresh " +
        "ephemeral server loads the latest published place version, runs your script in SERVER context " +
        "(require/ModuleScripts work; existing scripts do NOT auto-run; no physics), and returns the script's " +
        "`return` values + print logs. The closest thing to 'verify in production' without joining the game. " +
        "⚠ NOT a side-effect sandbox: DataStoreService and HttpService ARE available and PERSIST (a script " +
        "could even AssetService:SavePlaceAsync) — runtime/in-memory state is throwaway, but cloud writes are " +
        "real. Long scripts: if still running when the wait elapses, re-call with `resume` = the returned " +
        "task path. Needs an Open Cloud key with the luau-execution scope (TUFAN_OPENCLOUD_KEY) + a published " +
        "universe. For Studio EDIT-mode code use run_luau instead; for code inside a live Run-mode/Play-Solo test use playtest_probe instead.",
      inputSchema: {
        script: z.string().optional().describe("the Luau to run (end with `return ...` for values back). Omit when resuming."),
        timeoutSeconds: z.number().optional().describe("max script runtime on the server (default/max 300)"),
        waitSeconds: z.number().optional().describe("how long to poll before returning the task path (default 60)"),
        resume: z.string().optional().describe("a task path from a previous call to keep polling (instead of creating a new task)"),
        versionId: z.number().optional().describe("pin a specific published place version (default: latest)"),
        place: placeArg,
      },
    },
    async ({ script, timeoutSeconds, waitSeconds, resume, versionId, place }) => {
      const key = ocApiKey();
      if (!key) return errorText(CLOUD_LUAU_HELP);

      try {
        // Resolve the task to poll: resume an existing one, or create a new task.
        let taskPath: string;
        if (resume) {
          let rp = resume.trim();
          if (rp.startsWith(V2)) rp = rp.slice(V2.length); // tolerate a full URL
          taskPath = rp.replace(/^\/+/, "");
        } else {
          if (!script) return errorText("cloud_luau needs a `script` (or a `resume` task path).");
          const uni = await resolveUniverse(place);
          if (uni.error) return errorText(uni.error);
          if (!uni.placeId) return errorText("cloud_luau needs a connected place to run against (couldn't resolve the placeId).");
          const base = versionId
            ? `${V2}/universes/${uni.universeId}/places/${uni.placeId}/versions/${versionId}/luau-execution-session-tasks`
            : `${V2}/universes/${uni.universeId}/places/${uni.placeId}/luau-execution-session-tasks`;
          const reqBody: any = { script };
          if (timeoutSeconds) reqBody.timeout = `${Math.min(Math.max(Math.round(timeoutSeconds), 1), 300)}s`;
          const created = await ocFetch(base, key, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
          });
          if (!created.ok) return errorText(mapErr(created, key));
          taskPath = String(created.json?.path ?? "").replace(/^\/+/, "");
          if (!taskPath) return errorText(`task created but no path returned: ${scrub(created.body.slice(0, 300), key)}`);
        }

        // Poll the task `state` until terminal or the wait budget elapses.
        const deadline = Date.now() + Math.min(Math.max(waitSeconds ?? 60, 1), 280) * 1000;
        let delay = 1500;
        let task: any;
        for (;;) {
          const remaining = Math.max(1000, deadline - Date.now());
          const t = await ocFetch(`${V2}/${taskPath}`, key, {}, Math.min(30_000, remaining));
          if (!t.ok) return errorText(mapErr(t, key));
          task = t.json;
          const state = String(task?.state ?? "");
          if (state === "COMPLETE" || state === "FAILED" || state === "CANCELLED") break;
          if (Date.now() + delay > deadline) {
            return text(`⏳ still ${state || "running"} after the wait — re-call with resume:"${taskPath}" to keep polling.`);
          }
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(Math.round(delay * 1.5), 8000);
        }

        const state = String(task?.state ?? "");
        if (state === "CANCELLED") return text("task CANCELLED.");
        if (state === "FAILED") {
          const err = task?.error ?? {};
          const logs = await fetchLogs(taskPath, key);
          return text(`✗ FAILED (${err.code ?? "error"}): ${err.message ?? "(no message)"}${logs ? "\n--- logs ---\n" + cap(logs) : ""}`);
        }
        // COMPLETE
        const results = task?.output?.results;
        const logs = await fetchLogs(taskPath, key);
        const out = results !== undefined ? JSON.stringify(results, null, 2) : "(no return value)";
        return text(`✓ COMPLETE\nreturn: ${cap(out)}${logs ? "\n--- logs ---\n" + cap(logs) : ""}`);
      } catch (e) {
        return errorText(`cloud_luau failed: ${scrub((e as Error).message, key)}`);
      }
    },
  );
}
