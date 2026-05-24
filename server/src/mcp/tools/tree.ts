import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerTreeTools(server: McpServer) {
  server.registerTool(
    "get_children",
    { description: "Direct children (name + className) of the instance at path.", inputSchema: { path: z.string(), place: placeArg } },
    async ({ path, place }) =>
      runStudio("getChildren", { path }, (r) =>
        Array.isArray(r?.children) ? r.children.map((c: any) => `${c.className}  ${c.name}`).join("\n") : "(none)",
        place,
      ),
  );

  server.registerTool(
    "get_descendants",
    { description: "All descendants of path up to maxDepth (default 5).", inputSchema: { path: z.string(), maxDepth: z.number().optional(), place: placeArg } },
    async ({ path, maxDepth, place }) =>
      runStudio("getDescendants", { path, maxDepth: maxDepth ?? 5 }, (r) =>
        Array.isArray(r?.descendants) ? r.descendants.map((d: any) => `${"  ".repeat(d.depth)}${d.className}  ${d.path}`).join("\n") : "(none)",
        place,
      ),
  );

  server.registerTool(
    "search_objects",
    { description: "Find instances by name substring and/or className under rootPath.", inputSchema: { rootPath: z.string().optional(), name: z.string().optional(), className: z.string().optional(), place: placeArg } },
    async ({ rootPath, name, className, place }) =>
      runStudio("searchObjects", { rootPath: rootPath ?? "game", name: name ?? null, className: className ?? null }, (r) =>
        Array.isArray(r?.paths) && r.paths.length ? r.paths.join("\n") : "(no matches)",
        place,
      ),
  );

  server.registerTool(
    "get_services",
    { description: "Top-level services in the DataModel.", inputSchema: { place: placeArg } },
    async ({ place }) => runStudio("getServices", {}, (r) => (Array.isArray(r?.services) ? r.services.join("\n") : "(none)"), place),
  );
}
