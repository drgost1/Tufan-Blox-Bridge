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
import { lockProject } from "./sync/lock.js";
import { ensureGitRepo, baselineCommitIfEmpty, ensureMirrorIgnored } from "./git/git.js";
import { loadRegistry, validatedBase } from "./registry.js";
import { runtimeConfig } from "./config.js";
import { log } from "./util/log.js";

// CLI commands: intercept BEFORE the MCP server starts. No args (or anything not
// a known command) keeps the byte-identical default: stdio MCP server.
const CLI_COMMANDS: Record<string, () => Promise<number>> = {
  "install-plugin": async () => (await import("./cli/installPlugin.js")).installPlugin(),
};
const cliCmd = process.argv[2];
if (cliCmd && CLI_COMMANDS[cliCmd]) {
  process.exit(await CLI_COMMANDS[cliCmd]());
}

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
          // Git is opt-in: only touch git when the user has enabled it. Otherwise
          // the mirror is plain files — no .git, no repo headache.
          if (runtimeConfig.gitEnabled) {
            ensureMirrorIgnored(validatedBase()); // keep projects/ out of the user's project repo
            await ensureGitRepo(session.mirrorRoot); // per-place repo
          }
          await pullPlace(session); // unlocks + dumps the script tree locally (no git needed)
          if (runtimeConfig.gitEnabled) {
            await baselineCommitIfEmpty(session.mirrorRoot); // never leave the mirror at 0 commits
          }
          startMirrorWatcher(session); // file -> Studio for the mirror
          log(`[${session.placeName}] mirror ready${runtimeConfig.gitEnabled ? " (git on)" : " (git off)"}: ${session.mirrorRoot}`);
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
        void lockProject(s.mirrorRoot); // async chmod walk — fire and forget
      }
    },
    onReconnect: (s) => {
      if (s.mirrorRoot) {
        // pullPlace unlocks the mirror itself; if its pre-pull snapshot refuses
        // (git misconfigured), it throws and the mirror stays locked — which is
        // the safe outcome (don't sync over uncommitted work). Log, don't swallow.
        void pullPlace(s)
          .then(() => startMirrorWatcher(s))
          .catch((e) => log(`[${s.placeName}] reconnect pull skipped: ${(e as Error).message}`));
      }
    },
  });

  startBridge({ autoCommitOnStudioEdit: process.env.TUFAN_AUTOCOMMIT === "1" });

  const server = createServer();
  const transport = new StdioServerTransport();
  // Exit when the MCP client (Claude/Cursor session) disconnects. The HTTP bridge
  // keeps the event loop alive, so without this a closed session would leave an
  // orphan holding the port — the root of the old -32000 reconnect failures, and
  // it's what lets a dormant sibling session take over cleanly when this one ends.
  transport.onclose = () => {
    log("stdio client disconnected — exiting so the port frees");
    process.exit(0);
  };
  process.stdin.on("close", () => process.exit(0)); // belt-and-suspenders
  await server.connect(transport);
  log("MCP server connected over stdio");
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
