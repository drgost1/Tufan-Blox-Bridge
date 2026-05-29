import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, requireWritable, errorText } from "../helpers.js";

export function registerTagTools(server: McpServer) {
  server.registerTool(
    "tag",
    {
      description:
        "Read or change CollectionService tags on the instance at path. action='get' lists its tags; " +
        "'add'/'remove' need `tag`. (Replaces get_tags + add_tag + remove_tag.) To find ALL instances " +
        "carrying a tag, use get_tagged instead.",
      inputSchema: {
        path: z.string(),
        action: z.enum(["get", "add", "remove"]).describe("get = list this instance's tags; add/remove need `tag`"),
        tag: z.string().optional().describe("required for add/remove"),
        place: placeArg,
      },
    },
    async ({ path, action, tag, place }) => {
      if (action === "get") {
        return runStudio("getTags", { path }, (r) => (Array.isArray(r?.tags) && r.tags.length ? r.tags.join("\n") : "(no tags)"), place);
      }
      const blocked = requireWritable();
      if (blocked) return blocked;
      if (!tag) return errorText(`action "${action}" requires a tag`);
      if (action === "add") return runStudio("addTag", { path, tag }, () => `Added tag "${tag}"`, place);
      return runStudio("removeTag", { path, tag }, () => `Removed tag "${tag}"`, place);
    },
  );

  server.registerTool(
    "get_tagged",
    {
      description: "All instances carrying a CollectionService tag, optionally filtered to a className (IsA).",
      inputSchema: {
        tag: z.string(),
        className: z.string().optional().describe("only return instances that IsA this class, e.g. 'BasePart'"),
        place: placeArg,
      },
    },
    async ({ tag, className, place }) =>
      runStudio("getTagged", { tag, className: className ?? null }, (r) =>
        Array.isArray(r?.paths) && r.paths.length ? r.paths.join("\n") : "(none tagged)",
        place,
      ),
  );
}
