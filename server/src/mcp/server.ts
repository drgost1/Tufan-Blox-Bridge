import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "./helpers.js";
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
import { registerPlaceTools } from "./tools/places.js";
import { registerSelectionTools } from "./tools/selection.js";
import { registerTagTools } from "./tools/tags.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerHttpTools } from "./tools/http.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "tufan-blox-bridge", version: "0.4.0" });

  // Round-trip health check.
  server.registerTool(
    "ping",
    {
      description: "Ping a connected Studio place. Returns its place name + session.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => runStudio("ping", {}, (r) => `pong — place="${r?.placeName ?? "?"}" (${r?.placeId ?? "?"}) session=${r?.sessionId ?? "?"}`, place),
  );

  registerPlaceTools(server);
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
  registerSelectionTools(server);
  registerTagTools(server);
  registerSecurityTools(server);
  registerHttpTools(server);

  return server;
}
