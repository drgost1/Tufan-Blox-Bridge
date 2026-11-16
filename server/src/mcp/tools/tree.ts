import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, pathArg, optionalPathArg } from "../helpers.js";

export function registerTreeTools(server: McpServer) {
  // get_children killed → get_tree(maxDepth=1) gives the same child list (+ collapse).

  server.registerTool(
    "get_descendants",
    {
      description:
        "List every descendant of an instance, one line each with its class and full path, down to a depth limit. Read-only. " +
        "Gives exact paths you can pass to other tools, but nothing is folded, so it gets long on big models: prefer get_tree to map a large area, and describe for one instance in detail.",
      inputSchema: {
        path: pathArg("Instance whose descendants to list"),
        maxDepth: z.number().int().min(1).optional().describe("How many levels below path to include. Default 5."),
        place: placeArg,
      },
    },
    async ({ path, maxDepth, place }) =>
      runStudio("getDescendants", { path, maxDepth: maxDepth ?? 5 }, (r) =>
        Array.isArray(r?.descendants) ? r.descendants.map((d: any) => `${"  ".repeat(d.depth)}${d.className}  ${d.path}`).join("\n") : "(none)",
        place,
      ),
  );

  server.registerTool(
    "get_tree",
    {
      description:
        "Map the hierarchy under an instance with as few tokens as possible: runs of same-class siblings fold into one \"ClassName ×N\" line, so a 4,000-part model costs about one line. Read-only. " +
        "Start here to understand a place or a large model. For exact paths of every descendant use get_descendants; for one instance's properties, tags and children use describe.",
      inputSchema: {
        path: pathArg('Root of the tree to map, e.g. "Workspace" or "StarterGui"'),
        maxDepth: z.number().int().min(1).optional().describe("How many levels below path to include. Default 4."),
        collapseMin: z.number().int().min(1).optional().describe("Fold a run of same-class siblings once it is longer than this. Default 6."),
        className: z.string().optional().describe('Only show descendants that are this class or inherit from it, e.g. "BasePart" or "Script".'),
        place: placeArg,
      },
    },
    async ({ path, maxDepth, collapseMin, className, place }) =>
      runStudio(
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
        "Find instances by name, class or both under a root and list their paths. Read-only; stops at 200 results and says so, so narrow the search when that happens. " +
        "Use matchMode exact or wholeWord to cut the noise of substring matches. " +
        "To match a property value (every part with Material=Wood) use search_by_property; to search the Roblox marketplace use search_assets.",
      inputSchema: {
        rootPath: optionalPathArg("Where to start searching", "the whole DataModel (game)"),
        name: z.string().optional().describe("Text to match against instance names. Omit to match any name (then give className)."),
        className: z.string().optional().describe('Only match this class or classes that inherit from it, e.g. "Model" or "GuiObject".'),
        matchMode: z.enum(["substring", "exact", "wholeWord", "regex"]).optional().describe("How name is matched. regex uses Lua patterns. Default substring."),
        caseSensitive: z.boolean().optional().describe("Match name case-sensitively. Default false."),
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
    {
      description:
        "List the top-level services of the open place (Workspace, ReplicatedStorage, StarterGui and so on). Read-only. " +
        "Use it to orient in an unfamiliar place, then get_tree on the service you care about.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => runStudio("getServices", {}, (r) => (Array.isArray(r?.services) ? r.services.join("\n") : "(none)"), place),
  );
}
