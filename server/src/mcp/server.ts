import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "./helpers.js";
import { registerScriptTools } from "./tools/scripts.js";
import { registerInstanceTools } from "./tools/instances.js";
import { registerPropertyTools } from "./tools/properties.js";
import { registerTreeTools } from "./tools/tree.js";
import { registerLuauTools } from "./tools/luau.js";
import { registerLogTools } from "./tools/logs.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerCaptureTools } from "./tools/capture.js";
import { registerPlaytestTools } from "./tools/playtest.js";
import { registerGitTools } from "./tools/git.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "tufan-blox-bridge",
    version: "0.1.0",
  });

  // Round-trip health check — proves AI -> server -> plugin -> server -> AI.
  server.registerTool(
    "ping",
    {
      description: "Ping the Studio plugin. Returns pong with the plugin's place name — use to confirm the bridge is live.",
      inputSchema: {},
    },
    async () => runStudio("ping", {}, (r) => `pong — place="${r?.placeName ?? "?"}" session=${r?.sessionId ?? "?"}`),
  );

  registerScriptTools(server);
  registerInstanceTools(server);
  registerPropertyTools(server);
  registerTreeTools(server);
  registerLuauTools(server);
  registerLogTools(server);
  registerAssetTools(server);
  registerCaptureTools(server);
  registerPlaytestTools(server);
  registerGitTools(server);

  return server;
}
