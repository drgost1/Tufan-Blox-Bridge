// HTTP bridge — the localhost endpoint the Studio plugin polls.

import express from "express";
import type { Project } from "../sync/project.js";
import { applyStudioChange, type WriterOptions } from "../sync/writer.js";
import {
  nextCommand,
  resolveResponse,
  setPluginConnected,
} from "./queue.js";
import { BRIDGE_PORT, type CommandResponse, type ReadyMessage, type StudioChange } from "./protocol.js";
import { log } from "../util/log.js";

let lastSessionId: string | null = null;
let lastSeen = 0;

export function getBridgeStatus() {
  return { sessionId: lastSessionId, lastSeen };
}

export function startBridge(project: Project | null, writerOpts: WriterOptions) {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.post("/ready", (req, res) => {
    const msg = req.body as ReadyMessage;
    lastSessionId = msg.sessionId ?? null;
    lastSeen = Date.now();
    setPluginConnected(true);
    log(`plugin ready — session ${msg.sessionId} place "${msg.placeName ?? "?"}"`);
    res.json({ ok: true });
  });

  app.get("/poll", async (_req, res) => {
    lastSeen = Date.now();
    setPluginConnected(true);
    const cmd = await nextCommand();
    if (cmd) res.json(cmd);
    else res.status(204).end();
  });

  app.post("/response", (req, res) => {
    const msg = req.body as CommandResponse;
    resolveResponse(msg.id, msg.ok, msg.result, msg.error);
    res.json({ ok: true });
  });

  app.post("/studio-change", (req, res) => {
    const msg = req.body as StudioChange;
    if (!project) {
      res.json({ ok: false, error: "no project loaded" });
      return;
    }
    const r = applyStudioChange(project, msg.studioPath, msg.source, writerOpts);
    res.json({ ok: r.written, relPath: r.relPath });
  });

  // Passive liveness endpoint — used by the plugin's health pill. Does NOT
  // consume the command queue.
  app.get("/", (_req, res) => {
    res.json({ name: "tufan-blox-bridge", ok: true });
  });

  app.listen(BRIDGE_PORT, "127.0.0.1", () => {
    log(`bridge listening on http://127.0.0.1:${BRIDGE_PORT}`);
  });
}
