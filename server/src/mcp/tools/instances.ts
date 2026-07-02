import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerInstanceTools(server: McpServer) {
  server.registerTool(
    "create_instance",
    {
      description: "Create a new instance of className under parentPath, with optional name and properties.",
      inputSchema: {
        className: z.string(),
        parentPath: z.string(),
        name: z.string().optional(),
        properties: z.record(z.any()).optional().describe("name -> value (primitive or {Vector3:[x,y,z]} etc.)"),
        place: placeArg,
      },
    },
    async ({ className, parentPath, name, properties, place }) =>
      runStudio("createInstance", { className, parentPath, name, properties: properties ?? {} }, (r) => `Created ${r.path}`, place),
  );

  server.registerTool(
    "delete_instance",
    { description: "Destroy the instance at path.", inputSchema: { path: z.string(), place: placeArg } },
    async ({ path, place }) => runStudio("deleteInstance", { path }, () => `Deleted ${path}`, place),
  );

  server.registerTool(
    "clone_instance",
    { description: "Clone the instance at path under parentPath (defaults to same parent).", inputSchema: { path: z.string(), parentPath: z.string().optional(), place: placeArg } },
    async ({ path, parentPath, place }) => runStudio("cloneInstance", { path, parentPath }, (r) => `Cloned to ${r.path}`, place),
  );

  server.registerTool(
    "move_instance",
    { description: "Reparent the instance at path to newParentPath.", inputSchema: { path: z.string(), newParentPath: z.string(), place: placeArg } },
    async ({ path, newParentPath, place }) => runStudio("moveInstance", { path, newParentPath }, (r) => `Moved to ${r.path}`, place),
  );

  server.registerTool(
    "rename_instance",
    { description: "Rename the instance at path.", inputSchema: { path: z.string(), newName: z.string(), place: placeArg } },
    async ({ path, newName, place }) => runStudio("renameInstance", { path, newName }, (r) => `Renamed to ${r.path}`, place),
  );

  // mass_create / mass_duplicate killed → batch (N× create_instance / clone_instance)
  // or create_tree for nested specs. All run in one round-trip + one undo entry.

  server.registerTool(
    "create_tree",
    {
      description:
        "Build a whole nested instance subtree from ONE spec, in one call + one undo. Ideal for UIs (a panel + all its children at once). tree = { className, name?, properties?, children?: [tree, ...] }.",
      inputSchema: {
        parentPath: z.string(),
        tree: z.any().describe("{ className, name?, properties?, children?: [...] } — nested instance spec"),
        place: placeArg,
      },
    },
    async ({ parentPath, tree, place }) => {
      // MCP clients often serialize a nested `any` argument as a JSON STRING.
      // Parse it back to an object so the plugin receives a real table.
      let spec = tree;
      if (typeof spec === "string") {
        try {
          spec = JSON.parse(spec);
        } catch {
          /* not JSON — pass through; plugin reports an invalid spec */
        }
      }
      return runStudio("createTree", { parentPath, tree: spec }, (r) => `Built ${r.created} instance(s); root ${r.path}`, place);
    },
  );

  server.registerTool(
    "history",
    {
      description: "Undo or redo the last change in Studio (ChangeHistoryService). (Replaces undo + redo.)",
      inputSchema: { direction: z.enum(["undo", "redo"]), place: placeArg },
    },
    async ({ direction, place }) => runStudio(direction, {}, () => (direction === "undo" ? "Undone" : "Redone"), place),
  );
}
