// HTTP bridge — the localhost endpoint every Studio plugin polls. Routes by
// session (one per connected place).

import express from "express";
import { applyStudioChange, applyStudioSync, type WriterOptions } from "../sync/writer.js";
import {
  onReady,
  getSession,
  listSessions,
  touch,
  nextCommandFor,
  resolveResponse,
} from "./sessions.js";
import { BRIDGE_PORT } from "./protocol.js";
import { runtimeConfig, setConfig } from "../config.js";
import * as git from "../git/git.js";
import { pullPlace } from "../sync/pull.js";
import { log } from "../util/log.js";

export function startBridge(writerOpts: WriterOptions) {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.post("/ready", (req, res) => {
    const { sessionId, placeId, gameId, placeName } = req.body ?? {};
    if (!sessionId || placeId === undefined) {
      res.status(400).json({ ok: false, error: "missing sessionId/placeId" });
      return;
    }
    const session = onReady({
      sessionId,
      placeId: Number(placeId),
      gameId: gameId !== undefined ? Number(gameId) : undefined,
      placeName: placeName ?? "Place",
    });
    res.json({ ok: true, root: session.root });
  });

  app.get("/poll", async (req, res) => {
    const sessionId = String(req.query.session ?? "");
    if (!sessionId || !getSession(sessionId)) {
      // unknown/expired session — tell plugin to re-/ready
      res.status(409).json({ error: "unknown session; re-ready" });
      return;
    }
    touch(sessionId);
    const cmd = await nextCommandFor(sessionId);
    if (cmd) res.json(cmd);
    else res.status(204).end();
  });

  app.post("/response", (req, res) => {
    const { sessionId, id, ok, result, error } = req.body ?? {};
    if (id) resolveResponse(sessionId, id, !!ok, result, error);
    res.json({ ok: true });
  });

  app.post("/studio-change", (req, res) => {
    const { sessionId, studioPath, source, className } = req.body ?? {};
    let session = sessionId ? getSession(sessionId) : undefined;
    if (!session) {
      // fallback: if exactly one place is connected, use it
      const all = listSessions();
      if (all.length === 1) session = all[0];
    }
    if (!session) {
      res.json({ ok: false, error: "unknown session" });
      return;
    }
    const r = applyStudioChange(session, studioPath, source, writerOpts, className);
    res.json({ ok: r.written, relPath: r.relPath });
  });

  // Batched structural sync from the plugin's reconcile: deletes, pastes,
  // duplicates, renames, reparents — anything that changes the script-path set.
  app.post("/studio-sync", (req, res) => {
    const { sessionId, removes, upserts } = req.body ?? {};
    let session = sessionId ? getSession(sessionId) : undefined;
    if (!session) {
      const all = listSessions();
      if (all.length === 1) session = all[0];
    }
    if (!session) {
      res.json({ ok: false, error: "unknown session" });
      return;
    }
    const r = applyStudioSync(session, { removes, upserts }, writerOpts);
    res.json({ ok: true, removed: r.removed, written: r.written });
  });

  // Git toggle switches from the plugin widget.
  app.get("/config", (_req, res) => res.json(runtimeConfig));
  app.post("/config", (req, res) => {
    setConfig(req.body ?? {});
    log(`config: autoCommit=${runtimeConfig.autoCommit} autoPush=${runtimeConfig.autoPush}`);
    res.json(runtimeConfig);
  });

  // ---- Git action buttons (plugin widget) ----------------------------------
  // Resolve the connected place's mirror repo from a sessionId (or the sole place).
  const sessionFor = (sessionId?: string) => {
    if (sessionId) return getSession(sessionId);
    const all = listSessions();
    return all.length === 1 ? all[0] : undefined;
  };
  const gitRootFor = (sessionId?: string): string | null => {
    const s = sessionFor(sessionId);
    return s?.mirrorRoot ?? null;
  };

  app.post("/git/commit", async (req, res) => {
    const root = gitRootFor(req.body?.sessionId);
    if (!root) return res.json({ ok: false, error: "no connected place mirror to commit" });
    try {
      const msg = (req.body?.message as string) || `manual commit — ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
      res.json({ ok: true, message: await git.commit(root, msg) });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  app.post("/git/push", async (req, res) => {
    const root = gitRootFor(req.body?.sessionId);
    if (!root) return res.json({ ok: false, error: "no connected place mirror" });
    try {
      res.json({ ok: true, message: await git.push(root) });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  // Backup now = commit any changes, then push (best-effort push).
  app.post("/git/backup", async (req, res) => {
    const root = gitRootFor(req.body?.sessionId);
    if (!root) return res.json({ ok: false, error: "no connected place mirror" });
    try {
      const committed = await git.commit(root, `backup — ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
      let pushed = "";
      try {
        pushed = " · " + (await git.push(root));
      } catch (e) {
        pushed = " · push skipped (" + (e as Error).message.split("\n")[0] + ")";
      }
      res.json({ ok: true, message: committed + pushed });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  // Setup GitHub = add/point 'origin' at a repo URL (upserts).
  app.post("/git/remote", async (req, res) => {
    const root = gitRootFor(req.body?.sessionId);
    if (!root) return res.json({ ok: false, error: "no connected place mirror" });
    const url = req.body?.url as string;
    if (!url) return res.json({ ok: false, error: "repo URL required" });
    try {
      res.json({ ok: true, message: await git.setRemoteOrigin(root, url) });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  // Re-pull the live Studio script tree into the mirror (refresh).
  app.post("/git/repull", async (req, res) => {
    const s = sessionFor(req.body?.sessionId);
    if (!s?.mirrorRoot) return res.json({ ok: false, error: "no connected place mirror" });
    try {
      const n = await pullPlace(s);
      res.json({ ok: true, message: `re-pulled ${n} script(s)` });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  // Status line for the widget: branch, dirty count, remote, last commit.
  app.get("/git/info", async (req, res) => {
    const root = gitRootFor(String(req.query.session ?? ""));
    if (!root) return res.json({ ok: false, error: "no connected place mirror" });
    try {
      res.json({ ok: true, ...(await git.info(root)) });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  app.get("/", (_req, res) => res.json({ name: "tufan-blox-bridge", ok: true, sessions: listSessions().length }));

  // Let a newer instance ask this one to step down (used for self-healing below).
  app.post("/shutdown", (_req, res) => {
    log("received /shutdown — stepping down so a newer instance can take the port");
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 100);
  });

  let dormantLogged = false;
  const startListening = () => {
    const server = app.listen(BRIDGE_PORT, "127.0.0.1", () => {
      log(`bridge listening on http://127.0.0.1:${BRIDGE_PORT}`);
      dormantLogged = false; // we became owner (possibly after a handoff)
    });

    server.on("error", async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EADDRINUSE") {
        log(`bridge server error: ${err.message}`);
        process.exit(1);
      }
      // Port is taken. CRUCIAL: never shut down whoever owns it — that was the
      // multi-session bug (a new session killing a live one). Instead stay DORMANT
      // and retry. When the owner's Claude session ends, its server exits on stdio
      // close (below) and frees the port; we then take over and the plugin
      // reconnects here automatically. Graceful handoff, zero disconnects.
      if (!dormantLogged) {
        dormantLogged = true;
        const holder = await probeHolder();
        if (holder?.isTufan) {
          log(
            `another Tufan-Blox-Bridge session owns the Studio bridge on ${BRIDGE_PORT}` +
              (holder.sessions ? ` (${holder.sessions} place(s) connected)` : "") +
              `. Staying dormant — Studio belongs to that session until it closes, then this ` +
              `one takes over. This session's Studio tools are inactive meanwhile.`,
          );
        } else {
          log(`port ${BRIDGE_PORT} held by ${holder === null ? "an unresponsive process" : "another app"}; retrying. Studio unaffected.`);
        }
      }
      setTimeout(startListening, 12_000); // periodic retry → takes over when the port frees
    });
  };
  startListening();
}

/** Probe whoever holds the port: a Tufan bridge (and how many places live), or other. */
async function probeHolder(): Promise<{ isTufan: boolean; sessions: number } | null> {
  try {
    const who: any = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
    if (who?.name !== "tufan-blox-bridge") return { isTufan: false, sessions: 0 };
    return { isTufan: true, sessions: Number(who.sessions ?? 0) };
  } catch {
    return null; // unresponsive
  }
}
