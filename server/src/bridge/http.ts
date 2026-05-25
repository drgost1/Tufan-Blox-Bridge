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
  dispatchTo,
  setProxyMode,
} from "./sessions.js";
import { BRIDGE_PORT } from "./protocol.js";
import { runtimeConfig, setConfig } from "../config.js";
import * as git from "../git/git.js";
import { pullPlace } from "../sync/pull.js";
import { validatedBase } from "../registry.js";
import { log } from "../util/log.js";

export function startBridge(writerOpts: WriterOptions) {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.post("/ready", (req, res) => {
    const { sessionId, placeId, gameId, placeName, settings } = req.body ?? {};
    if (!sessionId || placeId === undefined) {
      res.status(400).json({ ok: false, error: "missing sessionId/placeId" });
      return;
    }
    // Apply the plugin's persisted settings BEFORE onReady runs the connect flow,
    // so git setup (repo init / baseline) only happens when gitEnabled is true.
    if (settings && typeof settings === "object") setConfig(settings);
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
  app.post("/config", async (req, res) => {
    const wasGit = runtimeConfig.gitEnabled;
    setConfig(req.body ?? {});
    log(`config: git=${runtimeConfig.gitEnabled} autoCommit=${runtimeConfig.autoCommit} autoPush=${runtimeConfig.autoPush}`);
    // Turning Git ON for the first time: initialize the repo on every connected
    // place mirror right now (so the buttons work without waiting for a reconnect).
    if (!wasGit && runtimeConfig.gitEnabled) {
      for (const s of listSessions()) {
        if (!s.mirrorRoot) continue;
        try {
          git.ensureMirrorIgnored(validatedBase());
          await git.ensureGitRepo(s.mirrorRoot);
          await git.baselineCommitIfEmpty(s.mirrorRoot);
          log(`git enabled — initialized repo for ${s.placeName}`);
        } catch (e) {
          log(`git init failed for ${s.placeName}: ${(e as Error).message}`);
        }
      }
    }
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
  // Git is opt-in: refuse git actions (with a clear message) when it's off.
  const gitOff = (res: any): boolean => {
    if (runtimeConfig.gitEnabled) return false;
    res.json({ ok: false, error: "Git is off — turn on Git in the widget first (it's opt-in)." });
    return true;
  };

  app.post("/git/commit", async (req, res) => {
    if (gitOff(res)) return;
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
    if (gitOff(res)) return;
    const root = gitRootFor(req.body?.sessionId);
    if (!root) return res.json({ ok: false, error: "no connected place mirror" });
    try {
      res.json({ ok: true, message: await git.push(root) });
    } catch (e) {
      const m = (e as Error).message;
      const friendly = /no.*upstream|no.*remote|'origin'|does not appear to be a git repo/i.test(m)
        ? "No GitHub remote yet — click Setup GitHub (paste a repo URL) first."
        : m;
      res.json({ ok: false, error: friendly });
    }
  });

  // Backup now = commit any changes, then push (best-effort push).
  app.post("/git/backup", async (req, res) => {
    if (gitOff(res)) return;
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
    if (gitOff(res)) return;
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
    if (!runtimeConfig.gitEnabled) return res.json({ ok: false, error: "git off" });
    const root = gitRootFor(String(req.query.session ?? ""));
    if (!root) return res.json({ ok: false, error: "no connected place mirror" });
    try {
      res.json({ ok: true, ...(await git.info(root)) });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  // ---- Proxy: let concurrent Tufan sessions share THIS owner's plugin --------
  // A proxy session forwards its tool dispatches here; we run them through the
  // single plugin queue (serialized with everyone else's → no collisions).
  app.post("/proxy/dispatch", async (req, res) => {
    const { placeId, op, args, timeoutMs } = req.body ?? {};
    if (typeof placeId !== "number" || !op) return res.json({ ok: false, error: "missing placeId/op" });
    try {
      const result = await dispatchTo(placeId, op, args ?? {}, typeof timeoutMs === "number" ? timeoutMs : undefined);
      res.json({ ok: true, result });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });
  app.get("/proxy/places", (_req, res) => {
    res.json({
      places: listSessions().map((s) => ({
        sessionId: s.sessionId,
        placeId: s.placeId,
        gameId: s.gameId,
        placeName: s.placeName,
        root: s.root,
        mirrorRoot: s.mirrorRoot,
        lastSeen: s.lastSeen,
      })),
    });
  });

  app.get("/", (_req, res) => res.json({ name: "tufan-blox-bridge", ok: true, sessions: listSessions().length }));

  // Let a newer instance ask this one to step down (used for self-healing below).
  app.post("/shutdown", (_req, res) => {
    log("received /shutdown — stepping down so a newer instance can take the port");
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 100);
  });

  const OWNER_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
  let modeLogged = false;
  const startListening = () => {
    const server = app.listen(BRIDGE_PORT, "127.0.0.1", () => {
      log(`bridge listening on ${OWNER_URL} (owner)`);
      setProxyMode(null); // we own the bridge + plugin (also covers promotion after an owner died)
      modeLogged = false;
    });

    server.on("error", async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EADDRINUSE") {
        log(`bridge server error: ${err.message}`);
        process.exit(1);
      }
      // Port is taken — figure out by whom. NEVER shut down the owner.
      const holder = await probeHolder();
      if (holder?.isTufan) {
        // Another live Tufan session owns the plugin. Run as a PROXY: forward our
        // dispatch to it, share the place list. All sessions work CONCURRENTLY —
        // the owner serializes every command through the single plugin queue, so
        // no collisions. We keep retrying the bind so we promote to owner if it closes.
        setProxyMode(OWNER_URL);
        if (!modeLogged) {
          modeLogged = true;
          log(`another Tufan session owns the bridge — running as PROXY (forwarding to it). Studio tools work concurrently; will take over if it closes.`);
        }
      } else {
        setProxyMode(null);
        if (!modeLogged) {
          modeLogged = true;
          log(`port ${BRIDGE_PORT} held by ${holder === null ? "an unresponsive process" : "another app"}; retrying. Studio unaffected.`);
        }
      }
      setTimeout(startListening, 12_000); // retry → promote to owner when the port frees
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
