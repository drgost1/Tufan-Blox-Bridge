import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, runStudioCached, placeArg } from "../helpers.js";

export function registerTreeTools(server: McpServer) {
  // get_children killed → get_tree(maxDepth=1) gives the same child list (+ collapse).

  server.registerTool(
    "get_descendants",
    { description: "All descendants of path up to maxDepth (default 5).", inputSchema: { path: z.string(), maxDepth: z.number().optional(), place: placeArg } },
    async ({ path, maxDepth, place }) =>
      runStudioCached("getDescendants", { path, maxDepth: maxDepth ?? 5 }, (r) =>
        Array.isArray(r?.descendants) ? r.descendants.map((d: any) => `${"  ".repeat(d.depth)}${d.className}  ${d.path}`).join("\n") : "(none)",
        place,
      ),
  );

  server.registerTool(
    "get_tree",
    {
      description:
        "Token-lean tree dump: runs of same-class siblings beyond `collapseMin` (default 6) " +
        "fold into one 'ClassName ×N' line instead of listing every one — so a 4000-part model " +
        "costs ~1 line, not 4000. Use this over get_descendants on wide/repetitive trees to map " +
        "far more of the game per context window. Cached + auto-invalidated on writes.",
      inputSchema: {
        path: z.string(),
        maxDepth: z.number().optional().describe("default 4"),
        collapseMin: z.number().optional().describe("collapse same-class runs longer than this (default 6)"),
        className: z.string().optional().describe("only show descendants of this class"),
        place: placeArg,
      },
    },
    async ({ path, maxDepth, collapseMin, className, place }) =>
      runStudioCached(
        "getTree",
        { path, maxDepth: maxDepth ?? 4, collapseMin: collapseMin ?? 6, className: className ?? null },
        (r) =>
          Array.isArray(r?.lines) && r.lines.length
            ? r.lines.map((l: any) => `${"  ".repeat(l.depth)}${l.text}`).join("\n")
            : "(empty)",
        place,
      ),
  );

  server.registerTool(
    "search_objects",
    {
      description:
        "Find instances by name and/or className under rootPath. matchMode controls name matching: 'substring' (default), 'exact', 'wholeWord', or 'regex'. Use 'exact'/'wholeWord' to cut the noise that plain substring search produces. " +
        "For a property-VALUE search (e.g. every part with Material=Wood) use search_by_property instead; for the Roblox marketplace use search_assets.",
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
