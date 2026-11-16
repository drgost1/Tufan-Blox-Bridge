import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, pathArg, requireWritable, errorText } from "../helpers.js";

export function registerTagTools(server: McpServer) {
  server.registerTool(
    "tag",
    {
      description:
        "Read, add or remove CollectionService tags on one instance. get is read-only; add and remove change the instance and are blocked in read-only mode. " +
        "Tags are how scripts find groups of objects (CollectionService:GetTagged). To list every instance with a tag, use get_tagged.",
      inputSchema: {
        path: pathArg("Instance whose tags to read or change"),
        action: z.enum(["get", "add", "remove"]).describe('"get" lists the instance\'s tags; "add" and "remove" change one tag and need tag.'),
        tag: z.string().optional().describe('Tag name for add or remove, e.g. "Collectible". Ignored for get.'),
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
      description:
        "List the paths of every instance in the place that carries a CollectionService tag. Read-only. " +
        "Use it to check what a tag-driven script will act on. For one instance's tags use tag with action get.",
      inputSchema: {
        tag: z.string().describe('Tag name, exactly as set, e.g. "Collectible".'),
        className: z.string().optional().describe('Only return instances of this class or a subclass, e.g. "BasePart".'),
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
