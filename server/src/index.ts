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
import { setOnSessionConnect, startHeartbeat, experienceMirrorRoot } from "./bridge/sessions.js";
import { startWatcherForSession, startMirrorWatcher, stopMirrorWatcher } from "./sync/watcher.js";
import { resolveExperienceName } from "./sync/experience.js";
import { pullPlace } from "./sync/pull.js";
import { lockProject, unlockProject } from "./sync/lock.js";
import { ensureGitRepo, baselineCommitIfEmpty, ensureMirrorIgnored } from "./git/git.js";
import { loadRegistry, validatedBase } from "./registry.js";
import { log } from "./util/log.js";

async function main() {
  loadRegistry();
  if (process.env.TUFAN_PROJECT) log(`primary project: ${process.env.TUFAN_PROJECT}`);

  // On connect: legacy project.json sync (if any) + auto-mirror the place tree
  // under projects/<Experience>_<universeId>/<Place>_<placeId>/ (its own git repo).
  setOnSessionConnect((session) => {
    startWatcherForSession(session);
    if (session.placeId && session.placeId !== 0) {
      void (async () => {
        try {
          // experience name from the public API, else fall back to the place name
          const expName = (await resolveExperienceName(session.gameId)) ?? session.placeName;
          session.mirrorRoot = experienceMirrorRoot(expName, session.gameId, session.placeName, session.placeId);
          ensureMirrorIgnored(validatedBase()); // keep projects/ out of the user's project repo
          await ensureGitRepo(session.mirrorRoot); // per-place repo
          await pullPlace(session); // unlocks + dumps the script tree locally
          await baselineCommitIfEmpty(session.mirrorRoot); // never leave the mirror at 0 commits
          startMirrorWatcher(session); // file -> Studio for the mirror
          log(`[${session.placeName}] mirror ready: ${session.mirrorRoot}`);
        } catch (e) {
          log(`auto-mirror failed: ${(e as Error).message}`);
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
