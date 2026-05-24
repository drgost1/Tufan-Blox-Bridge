#!/usr/bin/env node
// Tufan-Blox-Bridge MCP server.
//
// Runs two transports in one process:
//   - stdio: the MCP/JSON-RPC channel the AI client (Claude Code / Cursor) speaks
//   - HTTP (127.0.0.1:58741): the bridge the Roblox Studio plugin long-polls
//
// Project root resolution: $TUFAN_PROJECT, else cwd. The AI client should be
// launched from (or configured with) the Roblox project folder so file sync +
// git target the right place.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp/server.js";
import { startBridge } from "./bridge/http.js";
import { Project } from "./sync/project.js";
import { startWatcher } from "./sync/watcher.js";
import { initGit } from "./git/git.js";
import { log } from "./util/log.js";

async function main() {
  const projectRoot = process.env.TUFAN_PROJECT ?? process.cwd();
  const autoCommit = process.env.TUFAN_AUTOCOMMIT === "1";

  initGit(projectRoot);

  const project = Project.load(projectRoot);
  if (project) {
    log(`project "${project.file.name}" — ${project.allScripts().length} mapped scripts, root ${projectRoot}`);
  } else {
    log(`no project.json under ${projectRoot}; Studio tools still work, file sync disabled`);
  }

  // Bridge first so the plugin can connect while the AI client initializes.
  startBridge(project, { autoCommitOnStudioEdit: autoCommit });
  if (project) startWatcher(project);

  const server = createServer();
  await server.connect(new StdioServerTransport());
  log("MCP server connected over stdio");
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
