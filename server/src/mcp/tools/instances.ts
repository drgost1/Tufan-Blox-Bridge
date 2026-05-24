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
}
