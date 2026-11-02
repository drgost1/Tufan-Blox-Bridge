import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "./helpers.js";
import { registerScriptTools } from "./tools/scripts.js";
import { registerInstanceTools } from "./tools/instances.js";
import { registerPropertyTools } from "./tools/properties.js";
import { registerTreeTools } from "./tools/tree.js";
import { registerLuauTools } from "./tools/luau.js";
import { registerLogTools } from "./tools/logs.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerGitTools } from "./tools/git.js";
import { registerPlaceTools } from "./tools/places.js";
import { registerSelectionTools } from "./tools/selection.js";
import { registerTagTools } from "./tools/tags.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerHttpTools } from "./tools/http.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerPerfTools } from "./tools/perf.js";
import { registerDescribeTools } from "./tools/describe.js";
import { registerSnapshotTools } from "./tools/snapshots.js";
import { registerResponsiveTools } from "./tools/responsive.js";
import { registerHealthTools } from "./tools/health.js";
import { registerImportTools } from "./tools/importing.js";
import { registerSpatialTools } from "./tools/spatial.js";
import { registerBlenderTools } from "./tools/blender.js";
import { registerMeshyTools } from "./tools/meshy.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerLintTools } from "./tools/lint.js";
import { registerSourcemapTools } from "./tools/sourcemap.js";
import { registerTypecheckTools } from "./tools/typecheck.js";
import { registerDataStoreTools } from "./tools/datastore.js";
import { registerCloudLuauTools } from "./tools/cloud_luau.js";
import { registerServerLogTools } from "./tools/serverLogs.js";
import { registerProjectContextTools } from "./tools/projectContext.js";
import { isPlaying, resolveTargetPlace } from "../bridge/sessions.js";
import { runtimeConfig } from "../config.js";
import { log } from "../util/log.js";

// Tools that change state. Hidden in read-only mode (TUFAN_READONLY=1) so an AI
// can explore a place with zero risk of mutating it — like boshyxd's Inspector.
const WRITE_TOOLS = new Set([
  "create_instance", "delete_instance", "clone_instance", "move_instance", "rename_instance",
  "create_tree", "history",
  "set_property", "mass_edit", "set_attribute", "mass_set_attribute",
  "edit_script_lines", "find_and_replace_in_scripts",
  "set_selection", "run_luau", "insert_asset", "batch",
  "patch_script", "snapshot", "restore", "delete_snapshot", "make_responsive",
  "git_commit", "git_push", "git_pull", "git_restore", "git_revert", "git_recover",
  // cross-place / mirror writers — also mutate state, so gate them too:
  // copy_script_across upserts a script into a destination place, pull_place
  // overwrites the on-disk mirror.
  "copy_script_across", "pull_place",
  // import_file uploads to the user's Roblox account AND inserts into the place.
  "import_file",
  // place_on raycasts to a surface and moves the object flush onto it.
  "place_on",
  // asset-generation pipeline: generate_asset uploads + inserts (like import_file);
  // meshy_generate spends real Meshy credits; blender_run executes native code on
  // the host (stricter posture than the Studio-sandboxed run_luau). meshy_task and
  // blender_process stay visible — local/status-only, can't mutate place or wallet.
  "generate_asset", "meshy_generate", "blender_run",
  // cloud_luau runs arbitrary server Luau against the published game (real DataStore/HTTP side effects).
  "cloud_luau",
  // NOTE: script_source + tag are mixed read/write — NOT hidden here; their write
  // path is guarded at call time via requireWritable() so reads stay available in
  // inspector mode.
]);

// The lean default surface. TUFAN_TOOLSET=core exposes ONLY these ~25 so the model
// isn't choosing among 70 tools every call ("many tools ≠ many hands"). Everything
// else still works — it's just off the default surface until TUFAN_TOOLSET=full
// (the default). The everyday hands that cover ~95% of work.
const CORE_TOOLS = new Set([
  "ping",
  "get_tree", "describe", "search_objects", "get_properties", "script_source", "get_recent_errors",
  "get_server_logs", "get_server_history", "project_context",
  "set_property", "mass_edit", "batch", "create_instance", "create_tree", "delete_instance",
  "patch_script", "run_luau", "project_health",
  "scan_perf", "scan_responsive", "make_responsive", "snapshot", "restore",
  "scene_state", "pick",
]);

// Sent to every MCP client at connect. An MCP server can't call another server's
// tools itself, so this is how the AI learns which server owns which job.
const ROUTING_INSTRUCTIONS = [
  "Tufan works on the EDIT copy of a place in Roblox Studio. Pair it with Roblox's official Studio MCP (the Roblox_Studio server) and route by job:",
  "- Screenshots: official screen_capture. Tufan has no screenshot tool.",
  "- Play tests: official start_stop_play, character_navigation, user_keyboard_input, user_mouse_input.",
  "- Real-time debugging in a running game: official execute_luau with datamodel_type Client or Server, plus get_console_output. Tufan's get_recent_errors also streams live errors.",
  "- Everything else, use Tufan: editing scripts and instances, bulk builds (batch, create_tree, mass_edit), snapshot/restore, git, backdoor and performance scans, asset import, DataStore and production logs.",
  "- Big jobs: Roblox allows the plugin about 500 HTTP requests a minute, roughly 240 Tufan calls. Prefer batch, create_tree and mass_edit over many single calls; past the limit calls wait instead of failing.",
  "If the official server isn't connected, tell the user instead of treating a Tufan result as proof of how the running game behaves.",
].join("\n");

const PLAY_SESSION_NOTE =
  "NOTE: Studio is in a Play session. This call used the EDIT copy, not the running game, and any change only shows up after Play stops. " +
  "To read or change the live game use the official Roblox_Studio MCP: execute_luau (datamodel_type Client or Server), get_console_output, screen_capture.";

// Tools that act on the place's edit copy, where a result could be mistaken for live game state.
const EDIT_COPY_TOOLS = new Set([
  ...[...WRITE_TOOLS].filter((name) => !/^git_|^meshy_|^blender_|^cloud_luau$|^generate_asset$|^pull_place$|^copy_script_across$|^import_file$/.test(name)),
  "get_tree", "get_descendants", "describe", "get_properties", "search_objects", "script_source",
  "scene_state", "pick", "objects_in_region", "project_health", "scan_perf",
  "tag", "get_tagged", "get_attributes", "grep_scripts", "search_by_property", "scan_responsive",
  "scan_backdoors", "find_duplicates", "get_services", "get_selection",
]);

function withPlaySessionNote(handler: (...args: any[]) => Promise<any>) {
  return async (...args: any[]) => {
    const result = await handler(...args);
    if (result?.isError) return result;
    const target = resolveTargetPlace(args[0]?.place);
    if (target.placeId !== undefined && isPlaying(target.placeId) && Array.isArray(result?.content)) {
      result.content.unshift({ type: "text", text: PLAY_SESSION_NOTE });
    }
    return result;
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "tufan-blox-bridge", version: "0.16.2" }, { instructions: ROUTING_INSTRUCTIONS });

  // Tiering: wrap registerTool once to drop tools that the active mode hides.
  //   TUFAN_READONLY=1     → hide every write tool (inspection only)
  //   TUFAN_TOOLSET=core   → expose ONLY the lean core (~22 hands)
  const readOnly = runtimeConfig.readOnly;
  const coreOnly = process.env.TUFAN_TOOLSET === "core";
  const orig = server.registerTool.bind(server);
  (server as any).registerTool = (name: string, config: unknown, handler: (...args: any[]) => Promise<any>) => {
    if (readOnly && WRITE_TOOLS.has(name)) return undefined;
    if (coreOnly && !CORE_TOOLS.has(name)) return undefined;
    return (orig as any)(name, config, EDIT_COPY_TOOLS.has(name) ? withPlaySessionNote(handler) : handler);
  };
  if (readOnly || coreOnly) {
    if (readOnly) log(`READ-ONLY mode — ${WRITE_TOOLS.size} write tools hidden; inspection only`);
    if (coreOnly) log(`CORE toolset — only ${CORE_TOOLS.size} core tools exposed (set TUFAN_TOOLSET=full for all)`);
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

  // Edit-vs-run state. Read-only guard for the write tools (a mutation landing
  // mid-simulation behaves differently), NOT playtest control — starting,
  // stopping and driving a play session is Roblox's official Studio MCP now.
  server.registerTool(
    "is_running",
    {
      description:
        "Whether a simulation is running in the target Studio: a Play session, Run mode, or plain edit mode. " +
        "Read-only state check — use it to confirm you're in edit mode before mutating. " +
        "To START/STOP a play session or send input, use Roblox's official Studio MCP.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) =>
      runStudio("isRunning", {}, (r) => {
        const target = resolveTargetPlace(place);
        if (target.placeId !== undefined && isPlaying(target.placeId)) {
          return "Play session running. Tufan still reaches the edit copy only; use the official Roblox_Studio MCP for the live game.";
        }
        return r?.running ? `running${r.runMode ? " (run mode)" : ""}` : "not running (edit mode)";
      }, place),
  );

  registerPlaceTools(server);
  registerScriptTools(server);
  registerInstanceTools(server);
  registerPropertyTools(server);
  registerTreeTools(server);
  registerLuauTools(server);
  registerLogTools(server);
  registerAssetTools(server);
  registerGitTools(server);
  registerSelectionTools(server);
  registerTagTools(server);
  registerSecurityTools(server);
  registerHttpTools(server);
  registerBatchTools(server);
  registerPerfTools(server);
  registerDescribeTools(server);
  registerSnapshotTools(server);
  registerResponsiveTools(server);
  registerHealthTools(server);
  registerImportTools(server);
  registerSpatialTools(server);
  registerBlenderTools(server);
  registerMeshyTools(server);
  registerGenerateTools(server);
  registerLintTools(server);
  registerSourcemapTools(server);
  registerTypecheckTools(server);
  registerDataStoreTools(server);
  registerCloudLuauTools(server);
  registerServerLogTools(server);
  registerProjectContextTools(server);

  return server;
}
