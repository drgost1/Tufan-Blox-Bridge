import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerSelectionTools(server: McpServer) {
  server.registerTool(
    "get_selection",
    { description: "What the user currently has selected in the Studio Explorer (paths + classes).", inputSchema: { place: placeArg } },
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
    { description: "Select the given instances in the Studio Explorer.", inputSchema: { paths: z.array(z.string()), place: placeArg } },
    async ({ paths, place }) => runStudio("setSelection", { paths }, (r) => `Selected ${r.count} instance(s)`, place),
  );
}
