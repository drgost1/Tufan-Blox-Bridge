#!/usr/bin/env node
// Tufan-Blox-Bridge MCP server.
//
// stdio: MCP/JSON-RPC channel for the AI client (Claude Code / Cursor)
// HTTP (127.0.0.1:58741): bridge that every Studio plugin long-polls
//
// Multi-project: each connected place is routed to its own project folder via
// the registry (keyed by PlaceId). $TUFAN_PROJECT binds the first/primary place.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp/server.js";
import { startBridge } from "./bridge/http.js";
import { setOnSessionConnect } from "./bridge/sessions.js";
import { startWatcherForSession } from "./sync/watcher.js";
import { loadRegistry } from "./registry.js";
import { log } from "./util/log.js";

async function main() {
  const autoCommit = process.env.TUFAN_AUTOCOMMIT === "1";

  loadRegistry();
  if (process.env.TUFAN_PROJECT) log(`primary project: ${process.env.TUFAN_PROJECT}`);

  // When a place connects, start its files->Studio watcher.
  setOnSessionConnect((session) => startWatcherForSession(session));

  startBridge({ autoCommitOnStudioEdit: autoCommit });

  const server = createServer();
  await server.connect(new StdioServerTransport());
  log("MCP server connected over stdio");
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
