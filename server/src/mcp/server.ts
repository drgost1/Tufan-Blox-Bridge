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
import { runtimeConfig } from "../config.js";
import { log } from "../util/log.js";

// Tools that change state. Hidden in read-only mode (TUFAN_READONLY=1) so an AI
// can explore a place with zero risk of mutating it — like boshyxd's Inspector.
const WRITE_TOOLS = new Set([
  "create_instance", "delete_instance", "clone_instance", "move_instance", "rename_instance",
  "create_tree", "undo", "redo",
  "set_property", "mass_edit", "set_attribute", "mass_set_attribute",
  "edit_script_lines", "find_and_replace_in_scripts",
  "set_selection", "run_luau", "insert_asset", "batch",
  "patch_script", "snapshot", "restore", "delete_snapshot", "playtest_input", "make_responsive",
  "git_commit", "git_push", "git_pull", "git_restore", "git_revert", "git_recover",
  "playtest",
  // cross-place / runtime / mirror writers — also mutate state, so gate them too:
  // copy_script_across upserts a script into a destination place, playtest_probe
  // runs arbitrary Luau in a live sim, pull_place overwrites the on-disk mirror.
  "copy_script_across", "playtest_probe", "pull_place",
  // import_file uploads to the user's Roblox account AND inserts into the place.
  "import_file",
  // place_on raycasts to a surface and moves the object flush onto it.
  "place_on",
  // asset-generation pipeline: generate_asset uploads + inserts (like import_file);
  // meshy_generate spends real Meshy credits; blender_run executes native code on
  // the host (stricter posture than the Studio-sandboxed run_luau). meshy_task and
  // blender_process stay visible — local/status-only, can't mutate place or wallet.
  "generate_asset", "meshy_generate", "blender_run",
  // NOTE: script_source + tag are mixed read/write — NOT hidden here; their write
  // path is guarded at call time via requireWritable() so reads stay available in
  // inspector mode.
]);

// The lean default surface. TUFAN_TOOLSET=core exposes ONLY these ~22 so the model
// isn't choosing among 70 tools every call ("many tools ≠ many hands"). Everything
// else still works — it's just off the default surface until TUFAN_TOOLSET=full
// (the default). The everyday hands that cover ~95% of work.
const CORE_TOOLS = new Set([
  "ping",
  "get_tree", "describe", "search_objects", "get_properties", "script_source", "get_recent_errors",
  "set_property", "mass_edit", "batch", "create_instance", "create_tree", "delete_instance",
  "patch_script", "run_luau", "project_health",
  "capture_screenshot", "scan_perf", "scan_responsive", "make_responsive", "snapshot", "restore",
  "scene_state", "pick",
]);

export function createServer(): McpServer {
  const server = new McpServer({ name: "tufan-blox-bridge", version: "0.12.0" });

  // Tiering: wrap registerTool once to drop tools that the active mode hides.
  //   TUFAN_READONLY=1     → hide every write tool (inspection only)
  //   TUFAN_TOOLSET=core   → expose ONLY the lean core (~22 hands)
  const readOnly = runtimeConfig.readOnly;
  const coreOnly = process.env.TUFAN_TOOLSET === "core";
  if (readOnly || coreOnly) {
    const orig = server.registerTool.bind(server);
    (server as any).registerTool = (name: string, ...rest: unknown[]) => {
      if (readOnly && WRITE_TOOLS.has(name)) return undefined;
      if (coreOnly && !CORE_TOOLS.has(name)) return undefined;
      return (orig as any)(name, ...rest);
    };
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

  return server;
}
