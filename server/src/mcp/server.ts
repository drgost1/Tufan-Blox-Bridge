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
import { log } from "../util/log.js";

// Tools that change state. Hidden in read-only mode (TUFAN_READONLY=1) so an AI
// can explore a place with zero risk of mutating it — like boshyxd's Inspector.
const WRITE_TOOLS = new Set([
  "create_instance", "delete_instance", "clone_instance", "move_instance", "rename_instance",
  "mass_create", "mass_duplicate", "create_tree", "undo", "redo",
  "set_property", "mass_set_property", "mass_edit", "set_attribute",
  "set_script_source", "edit_script_lines", "insert_script_lines", "delete_script_lines", "find_and_replace_in_scripts",
  "add_tag", "remove_tag", "set_selection", "run_luau", "insert_asset",
  "git_commit", "git_push", "git_pull", "git_restore", "git_revert", "git_recover", "git_remote", "git_branch",
  "start_playtest", "stop_playtest", "pause_playtest",
]);

export function createServer(): McpServer {
  const server = new McpServer({ name: "tufan-blox-bridge", version: "0.6.0" });

  // Read-only / safe mode: skip registering every write tool, so the AI only
  // sees inspection tools. Launch with TUFAN_READONLY=1.
  if (process.env.TUFAN_READONLY === "1") {
    const orig = server.registerTool.bind(server);
    (server as any).registerTool = (name: string, ...rest: unknown[]) =>
      WRITE_TOOLS.has(name) ? undefined : (orig as any)(name, ...rest);
    log(`READ-ONLY mode — ${WRITE_TOOLS.size} write tools hidden; inspection only`);
  }

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
