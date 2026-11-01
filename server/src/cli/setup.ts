// `tufan-blox-bridge setup` — one command that installs the server and the Studio
// plugin, then registers the server with Claude Code and/or Cursor for this folder.
// Standalone command: runs and exits BEFORE the MCP server starts (see src/index.ts).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installPlugin } from "./installPlugin.js";

const PACKAGE = "tufan-blox-bridge";
const SERVER_NAME = "tufan";

// One shell string: Node warns when args are passed alongside shell:true, and
// Windows needs a shell to find npm.cmd.
function run(command: string, args: string[] = []) {
  const line = [command, ...args.map((arg) => (/[\s&()]/.test(arg) ? `"${arg}"` : arg))].join(" ");
  return spawnSync(line, { encoding: "utf8", shell: true, timeout: 180_000 });
}

function onPath(command: string): boolean {
  return run(process.platform === "win32" ? "where" : "command -v", [command]).status === 0;
}

function installServer(): { command: string; args: string[] } {
  console.log(`> Installing the MCP server (npm i -g ${PACKAGE}@latest)`);
  const installed = run("npm", ["i", "-g", `${PACKAGE}@latest`]);
  if (installed.status === 0 && onPath(PACKAGE)) {
    console.log(`  [ok] ${PACKAGE} is on your PATH`);
    return { command: PACKAGE, args: [] };
  }
  console.log("  [!] Global install didn't work, so your AI client will start the server through npx instead.");
  return { command: "npx", args: ["-y", PACKAGE] };
}

function registerClaudeCode(project: string, server: { command: string; args: string[] }): boolean {
  run("claude", ["mcp", "remove", SERVER_NAME]);
  run("claude", ["mcp", "add", SERVER_NAME, "--env", `TUFAN_PROJECT=${project}`, "--", server.command, ...server.args]);
  const registered = (run("claude", ["mcp", "get", SERVER_NAME]).stdout ?? "").includes(PACKAGE);
  console.log(registered ? "  [ok] Registered with Claude Code for this folder" : "  [X] Claude Code registration didn't take effect");
  return registered;
}

function clientConfig(project: string, server: { command: string; args: string[] }) {
  const entry: Record<string, unknown> = { command: server.command, env: { TUFAN_PROJECT: project } };
  if (server.args.length) entry.args = server.args;
  return entry;
}

function registerCursor(project: string, server: { command: string; args: string[] }): boolean {
  const dir = join(process.cwd(), ".cursor");
  const file = join(dir, "mcp.json");
  let config: any = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      console.log(`  [X] ${file} isn't valid JSON, so I left it alone. Add the config below by hand.`);
      return false;
    }
  }
  config.mcpServers = { ...config.mcpServers, [SERVER_NAME]: clientConfig(project, server) };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  console.log(`  [ok] Registered with Cursor in ${file}`);
  return true;
}

export async function setup(): Promise<number> {
  const project = process.cwd().replace(/\\/g, "/");
  console.log(`Setting up Tufan-Blox-Bridge for ${project}\n`);

  const server = installServer();

  console.log("> Installing the Studio plugin");
  const pluginStatus = await installPlugin();

  console.log("> Registering with your AI client");
  let registered = false;
  if (onPath("claude")) registered = registerClaudeCode(project, server) || registered;
  if (existsSync(join(process.cwd(), ".cursor"))) registered = registerCursor(project, server) || registered;
  if (!registered) {
    console.log("  [!] Claude Code or a .cursor folder wasn't found, so nothing was registered automatically.");
    console.log("      Add this to your AI client's MCP config, keeping any servers already there:\n");
    console.log(JSON.stringify({ mcpServers: { [SERVER_NAME]: clientConfig(project, server) } }, null, 2));
  }

  console.log(
    `\nNext steps:\n` +
      `  1. Restart Roblox Studio and your AI client. If Studio asks whether the plugin may reach 127.0.0.1, allow it.\n` +
      `  2. Open the Tufan Studio button in the Studio toolbar. A green pill means it's connected.\n` +
      `  3. Also turn on Roblox's built-in MCP server (Assistant settings > MCP Servers). It handles play tests and screenshots.\n` +
      `  4. Ask your AI: "Use Tufan to run project_health on my place".`,
  );
  return pluginStatus;
}
