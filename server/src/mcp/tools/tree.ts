import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerTreeTools(server: McpServer) {
  server.registerTool(
    "get_children",
    { description: "Direct children (name + className) of the instance at path.", inputSchema: { path: z.string(), place: placeArg } },
    async ({ path, place }) =>
      runStudio("getChildren", { path }, (r) =>
        // distinguish "exists but empty" from a resolve failure (m9)
        Array.isArray(r?.children)
          ? (r.children.length ? r.children.map((c: any) => `${c.className}  ${c.name}`).join("\n") : "(empty — node exists, 0 children)")
          : "(could not resolve path)",
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
    {
      description:
        "Find instances by name and/or className under rootPath. matchMode controls name matching: 'substring' (default), 'exact', 'wholeWord', or 'regex'. Use 'exact'/'wholeWord' to cut the noise that plain substring search produces.",
      inputSchema: {
        rootPath: z.string().optional(),
        name: z.string().optional(),
        className: z.string().optional(),
        matchMode: z.enum(["substring", "exact", "wholeWord", "regex"]).optional().describe("name match mode (default substring)"),
        caseSensitive: z.boolean().optional().describe("default false"),
        place: placeArg,
      },
    },
    async ({ rootPath, name, className, matchMode, caseSensitive, place }) =>
      runStudio(
        "searchObjects",
        {
          rootPath: rootPath ?? "game",
          name: name ?? null,
          className: className ?? null,
          matchMode: matchMode ?? "substring",
          caseSensitive: caseSensitive ?? false,
        },
        (r) => {
          if (!Array.isArray(r?.paths) || !r.paths.length) return "(no matches)";
          const head = r.truncated ? `(showing first ${r.paths.length}, more exist — narrow the search)\n` : "";
          return head + r.paths.join("\n");
        },
        place,
      ),
  );

  server.registerTool(
    "get_services",
    { description: "Top-level services in the DataModel.", inputSchema: { place: placeArg } },
    async ({ place }) => runStudio("getServices", {}, (r) => (Array.isArray(r?.services) ? r.services.join("\n") : "(none)"), place),
  );
}
