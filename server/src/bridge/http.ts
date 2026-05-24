// HTTP bridge — the localhost endpoint every Studio plugin polls. Routes by
// session (one per connected place).

import express from "express";
import { applyStudioChange, type WriterOptions } from "../sync/writer.js";
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

  // Git toggle switches from the plugin widget.
  app.get("/config", (_req, res) => res.json(runtimeConfig));
  app.post("/config", (req, res) => {
    setConfig(req.body ?? {});
    log(`config: autoCommit=${runtimeConfig.autoCommit} autoPush=${runtimeConfig.autoPush}`);
    res.json(runtimeConfig);
  });

  app.get("/", (_req, res) => res.json({ name: "tufan-blox-bridge", ok: true }));

  const server = app.listen(BRIDGE_PORT, "127.0.0.1", () => {
    log(`bridge listening on http://127.0.0.1:${BRIDGE_PORT}`);
  });

  // A stale or duplicate server already holds the port — fail with a clear
  // message instead of an unhandled crash (common when an old npx instance
  // lingers or two editors both launch the bridge).
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log(
        `port ${BRIDGE_PORT} is already in use — another Tufan-Blox-Bridge ` +
          `server is likely running. Close it (or kill the process on that ` +
          `port) and relaunch. Studio is unaffected.`,
      );
    } else {
      log(`bridge server error: ${err.message}`);
    }
    process.exit(1);
  });
}
