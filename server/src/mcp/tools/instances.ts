import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, pathArg, optionalPathArg, VALUE_FORMAT } from "../helpers.js";

export function registerInstanceTools(server: McpServer) {
  server.registerTool(
    "create_instance",
    {
      description:
        "Create one new instance in the edit copy and return its path. Recorded as one Studio undo step. " +
        "A property that fails to set is skipped without an error, so read it back with get_properties when it matters. " +
        "For several instances use create_tree (a nested hierarchy) or batch (mixed operations), which run in one call.",
      inputSchema: {
        className: z.string().describe('Roblox class to create, e.g. "Part", "Frame", "ModuleScript". Must be creatable with Instance.new.'),
        parentPath: pathArg("Parent to create the instance under"),
        name: z.string().optional().describe("Name for the new instance. Defaults to the class name."),
        properties: z.record(z.string(), z.any()).optional().describe(`Property name to value, applied before parenting. ${VALUE_FORMAT}`),
        place: placeArg,
      },
    },
    async ({ className, parentPath, name, properties, place }) =>
      runStudio("createInstance", { className, parentPath, name, properties: properties ?? {} }, (r) => `Created ${r.path}`, place),
  );

  server.registerTool(
    "delete_instance",
    {
      description:
        "Destroy an instance and all of its descendants in the edit copy. Recorded as one Studio undo step, so history undo brings it back while the undo stack lasts. " +
        "For a checkpoint that outlives the undo stack, take a snapshot first. Fails if the path does not resolve.",
      inputSchema: { path: pathArg("Instance to destroy"), place: placeArg },
    },
    async ({ path, place }) => runStudio("deleteInstance", { path }, () => `Deleted ${path}`, place),
  );

  server.registerTool(
    "clone_instance",
    {
      description:
        "Copy an instance with all its descendants and return the copy's path. Recorded as one Studio undo step. " +
        "Instances with Archivable=false cannot be cloned. For many copies at once use batch with several clone operations.",
      inputSchema: {
        path: pathArg("Instance to copy"),
        parentPath: optionalPathArg("Parent for the copy", "the original's parent"),
        place: placeArg,
      },
    },
    async ({ path, parentPath, place }) => runStudio("cloneInstance", { path, parentPath }, (r) => `Cloned to ${r.path}`, place),
  );

  server.registerTool(
    "move_instance",
    {
      description:
        "Move an instance (with its descendants) under a different parent and return its new path. Recorded as one Studio undo step. " +
        "To change only the name use rename_instance; to keep the original and place a copy, use clone_instance.",
      inputSchema: {
        path: pathArg("Instance to move"),
        newParentPath: pathArg("New parent"),
        place: placeArg,
      },
    },
    async ({ path, newParentPath, place }) => runStudio("moveInstance", { path, newParentPath }, (r) => `Moved to ${r.path}`, place),
  );

  server.registerTool(
    "rename_instance",
    {
      description:
        "Change an instance's Name and return its new path. Recorded as one Studio undo step. " +
        "Scripts that find the instance by its old name will stop finding it, so search with grep_scripts first when renaming something code refers to.",
      inputSchema: {
        path: pathArg("Instance to rename"),
        newName: z.string().describe("The new Name. Duplicate names are allowed; Tufan then addresses the later sibling as \"Name (2)\"."),
        place: placeArg,
      },
    },
    async ({ path, newName, place }) => runStudio("renameInstance", { path, newName }, (r) => `Renamed to ${r.path}`, place),
  );

  // mass_create / mass_duplicate killed → batch (N× create_instance / clone_instance)
  // or create_tree for nested specs. All run in one round-trip + one undo entry.

  server.registerTool(
    "create_tree",
    {
      description:
        "Build a whole nested hierarchy from one spec in a single call and one Studio undo step, and return the root path and instance count. " +
        "Best for UIs and models (a panel and all its children at once). Properties that fail to set are skipped silently. " +
        "For one instance use create_instance; for mixed creates, edits and deletes use batch.",
      inputSchema: {
        parentPath: pathArg("Parent to build the tree under"),
        tree: z.any().describe(`Nested spec: { className, name?, properties?, children?: [spec, ...] }. A JSON string of the same shape is also accepted. Property values: ${VALUE_FORMAT}`),
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
      description:
        "Step Studio's own undo history back or forward one entry, exactly like Ctrl+Z or Ctrl+Y. It affects the latest change by anyone, including the user, not only Tufan's. " +
        "Each Tufan write (and each batch, create_tree or mass_edit) is one entry. For anything older than the undo stack, use restore (snapshots) or restore_from_mirror.",
      inputSchema: {
        direction: z.enum(["undo", "redo"]).describe('"undo" reverts the latest change; "redo" re-applies the last undone one.'),
        place: placeArg,
      },
    },
    async ({ direction, place }) => runStudio(direction, {}, () => (direction === "undo" ? "Undone" : "Redone"), place),
  );
}
