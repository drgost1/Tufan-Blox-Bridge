import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerSelectionTools(server: McpServer) {
  server.registerTool(
    "get_selection",
    {
      description:
        "Return what the user has selected in Studio right now, one line per instance with class and path. Read-only. " +
        "Use it when the user says \"this\" or \"the selected part\" instead of guessing a path.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) =>
      runStudio("getSelection", {}, (r) =>
        Array.isArray(r?.selection) && r.selection.length
          ? r.selection.map((s: any) => `${s.className}  ${s.path}`).join("\n")
          : "(nothing selected)",
        place,
      ),
  );

  server.registerTool(
    "set_selection",
    {
      description:
        "Replace the user's Studio selection with the given instances, to point them at something or prepare for a Studio command. " +
        "Changes only the selection, never the instances. Paths that do not resolve are skipped; the reply says how many were selected. An empty list clears the selection.",
      inputSchema: {
        paths: z.array(z.string()).describe('Dot paths to select, e.g. ["Workspace.Map.Door", "Workspace.Map.Window"].'),
        place: placeArg,
      },
    },
    async ({ paths, place }) => runStudio("setSelection", { paths }, (r) => `Selected ${r.count} instance(s)`, place),
  );
}
