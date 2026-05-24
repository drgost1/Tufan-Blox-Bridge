import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerInstanceTools(server: McpServer) {
  server.registerTool(
    "create_instance",
    {
      description: "Create a new instance of className under parentPath, optionally with a name and properties.",
      inputSchema: {
        className: z.string(),
        parentPath: z.string(),
        name: z.string().optional(),
        properties: z.record(z.any()).optional().describe("Property name -> value (primitives, or {Vector3:[x,y,z]} etc.)"),
      },
    },
    async ({ className, parentPath, name, properties }) =>
      runStudio("createInstance", { className, parentPath, name, properties: properties ?? {} }, (r) => `Created ${r.path}`),
  );

  server.registerTool(
    "delete_instance",
    {
      description: "Destroy the instance at the given path.",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => runStudio("deleteInstance", { path }, () => `Deleted ${path}`),
  );

  server.registerTool(
    "clone_instance",
    {
      description: "Clone the instance at path and parent the clone under parentPath (defaults to same parent).",
      inputSchema: { path: z.string(), parentPath: z.string().optional() },
    },
    async ({ path, parentPath }) => runStudio("cloneInstance", { path, parentPath }, (r) => `Cloned to ${r.path}`),
  );

  server.registerTool(
    "move_instance",
    {
      description: "Reparent the instance at path to newParentPath.",
      inputSchema: { path: z.string(), newParentPath: z.string() },
    },
    async ({ path, newParentPath }) => runStudio("moveInstance", { path, newParentPath }, (r) => `Moved to ${r.path}`),
  );

  server.registerTool(
    "rename_instance",
    {
      description: "Rename the instance at path.",
      inputSchema: { path: z.string(), newName: z.string() },
    },
    async ({ path, newName }) => runStudio("renameInstance", { path, newName }, (r) => `Renamed to ${r.path}`),
  );
}
