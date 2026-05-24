import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerTreeTools(server: McpServer) {
  server.registerTool(
    "get_children",
    {
      description: "List the direct children (name + className) of the instance at path.",
      inputSchema: { path: z.string() },
    },
    async ({ path }) =>
      runStudio("getChildren", { path }, (r) =>
        Array.isArray(r?.children) ? r.children.map((c: any) => `${c.className}  ${c.name}`).join("\n") : "(none)",
      ),
  );

  server.registerTool(
    "get_descendants",
    {
      description: "List all descendants of the instance at path, up to maxDepth (default 5). Returns class + path.",
      inputSchema: { path: z.string(), maxDepth: z.number().optional() },
    },
    async ({ path, maxDepth }) =>
      runStudio("getDescendants", { path, maxDepth: maxDepth ?? 5 }, (r) =>
        Array.isArray(r?.descendants) ? r.descendants.map((d: any) => `${"  ".repeat(d.depth)}${d.className}  ${d.path}`).join("\n") : "(none)",
      ),
  );

  server.registerTool(
    "search_objects",
    {
      description: "Find instances by name (substring) and/or className under rootPath.",
      inputSchema: {
        rootPath: z.string().optional(),
        name: z.string().optional(),
        className: z.string().optional(),
      },
    },
    async ({ rootPath, name, className }) =>
      runStudio("searchObjects", { rootPath: rootPath ?? "game", name: name ?? null, className: className ?? null }, (r) =>
        Array.isArray(r?.paths) && r.paths.length ? r.paths.join("\n") : "(no matches)",
      ),
  );

  server.registerTool(
    "get_services",
    {
      description: "List the top-level services in the DataModel.",
      inputSchema: {},
    },
    async () =>
      runStudio("getServices", {}, (r) => (Array.isArray(r?.services) ? r.services.join("\n") : "(none)")),
  );
}
