import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

// Public tool name -> internal plugin op. The batch item `args` are exactly the
// args you'd pass that tool (minus `place`). Unknown ops are passed through as-is
// so the internal op name also works.
const OP_MAP: Record<string, string> = {
  create_instance: "createInstance",
  delete_instance: "deleteInstance",
  clone_instance: "cloneInstance",
  move_instance: "moveInstance",
  rename_instance: "renameInstance",
  mass_create: "massCreate",
  mass_duplicate: "massDuplicate",
  create_tree: "createTree",
  set_property: "setProperty",
  mass_set_property: "massSetProperty",
  mass_edit: "massEdit",
  set_attribute: "setAttribute",
  add_tag: "addTag",
  remove_tag: "removeTag",
  set_script_source: "setScriptSource",
  edit_script_lines: "editScriptLines",
  insert_script_lines: "insertScriptLines",
  delete_script_lines: "deleteScriptLines",
  find_and_replace_in_scripts: "findAndReplace",
  set_selection: "setSelection",
  // reads (so you can interleave a read mid-batch)
  get_properties: "getProperties",
  get_children: "getChildren",
  get_script_source: "getScriptSource",
};

const SUPPORTED = Object.keys(OP_MAP).join(", ");

export function registerBatchTools(server: McpServer) {
  server.registerTool(
    "batch",
    {
      description:
        "Run MANY operations in ONE round-trip and ONE undo entry. The single biggest " +
        "speed win for multi-step builds (a 40-instance UI = 1 call, not 40). Each op is " +
        "{ op, args } where args is exactly what that tool takes (omit `place`). Returns a " +
        "per-op result list. Set stopOnError to halt at the first failure.\nSupported ops: " +
        SUPPORTED +
        ". (create_tree / mass_* already batch one kind; use `batch` to mix different ops.)",
      inputSchema: {
        ops: z
          .array(
            z.object({
              op: z.string().describe("a supported op name, e.g. create_instance"),
              args: z.record(z.any()).optional().describe("that op's args (no `place`)"),
            }),
          )
          .describe("ordered list of operations"),
        stopOnError: z.boolean().optional().describe("halt at first failure (default false)"),
        place: placeArg,
      },
    },
    async ({ ops, stopOnError, place }) => {
      const mapped = ops.map((o) => {
        // Parity with create_tree: some MCP clients serialize a per-op args object
        // as a JSON STRING. Parse it back so the plugin gets a real table.
        let a: unknown = o.args ?? {};
        if (typeof a === "string") {
          try {
            a = JSON.parse(a);
          } catch {
            /* not JSON — pass through; the plugin op reports the bad arg */
          }
        }
        return { op: OP_MAP[o.op] ?? o.op, args: a };
      });
      return runStudio(
        "batch",
        { ops: mapped, stopOnError: stopOnError ?? false },
        (r) => {
          if (!Array.isArray(r?.results)) return JSON.stringify(r, null, 2);
          const lines = r.results.map((res: any, i: number) => {
            const tag = res.ok ? "✓" : "✗";
            const detail = res.ok
              ? typeof res.result === "object"
                ? JSON.stringify(res.result)
                : String(res.result ?? "")
              : res.error;
            return `${tag} [${i}] ${ops[i]?.op ?? "?"}${detail ? " — " + detail : ""}`;
          });
          return `batch: ${r.ok}/${r.total} ok${r.failed ? `, ${r.failed} failed` : ""}\n` + lines.join("\n");
        },
        place,
      );
    },
  );
}
