#!/usr/bin/env node
// Tufan-Blox-Bridge MCP server.
//
// stdio: MCP/JSON-RPC channel for the AI client (Claude Code / Cursor)
// HTTP (127.0.0.1:58741): bridge that every Studio plugin long-polls
//
// On connect, a published place auto-mirrors its script tree to
// <TUFAN_PROJECT>/projects/<name>_<placeId>/ and that folder syncs two-way.
// When the place disconnects, the mirror is made read-only (copy-only) until
// it reconnects.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp/server.js";
import { startBridge } from "./bridge/http.js";
import { setOnSessionConnect, startHeartbeat } from "./bridge/sessions.js";
import { startWatcherForSession, startMirrorWatcher, stopMirrorWatcher } from "./sync/watcher.js";
import { pullPlace } from "./sync/pull.js";
import { lockProject, unlockProject } from "./sync/lock.js";
import { loadRegistry } from "./registry.js";
import { log } from "./util/log.js";

async function main() {
  loadRegistry();
  if (process.env.TUFAN_PROJECT) log(`primary project: ${process.env.TUFAN_PROJECT}`);

  // On connect: legacy project.json sync (if any) + auto-mirror the place tree.
  setOnSessionConnect((session) => {
    startWatcherForSession(session);
    if (session.mirrorRoot) {
      void (async () => {
        try {
          await pullPlace(session); // unlocks + dumps the script tree locally
          startMirrorWatcher(session); // file -> Studio for the mirror
        } catch (e) {
          log(`auto-pull failed: ${(e as Error).message}`);
        }
      })();
    }
  });

  // Lock the mirror when the place drops; restore + re-pull when it returns.
  startHeartbeat({
    onDisconnect: (s) => {
      if (s.mirrorRoot) {
        stopMirrorWatcher(s.sessionId);
        lockProject(s.mirrorRoot);
      }
    },
    onReconnect: (s) => {
      if (s.mirrorRoot) {
        unlockProject(s.mirrorRoot);
        void pullPlace(s).then(() => startMirrorWatcher(s)).catch(() => {});
      }
    },
  });

  startBridge({ autoCommitOnStudioEdit: process.env.TUFAN_AUTOCOMMIT === "1" });

  const server = createServer();
  await server.connect(new StdioServerTransport());
  log("MCP server connected over stdio");
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
