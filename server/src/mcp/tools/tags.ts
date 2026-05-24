import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerTagTools(server: McpServer) {
  server.registerTool(
    "get_tags",
    { description: "CollectionService tags on the instance at path.", inputSchema: { path: z.string(), place: placeArg } },
    async ({ path, place }) =>
      runStudio("getTags", { path }, (r) => (Array.isArray(r?.tags) && r.tags.length ? r.tags.join("\n") : "(no tags)"), place),
  );

  server.registerTool(
    "add_tag",
    { description: "Add a CollectionService tag to the instance at path.", inputSchema: { path: z.string(), tag: z.string(), place: placeArg } },
    async ({ path, tag, place }) => runStudio("addTag", { path, tag }, () => `Added tag "${tag}"`, place),
  );

  server.registerTool(
    "remove_tag",
    { description: "Remove a CollectionService tag from the instance at path.", inputSchema: { path: z.string(), tag: z.string(), place: placeArg } },
    async ({ path, tag, place }) => runStudio("removeTag", { path, tag }, () => `Removed tag "${tag}"`, place),
  );

  server.registerTool(
    "get_tagged",
    { description: "All instances carrying a CollectionService tag.", inputSchema: { tag: z.string(), place: placeArg } },
    async ({ tag, place }) =>
      runStudio("getTagged", { tag }, (r) => (Array.isArray(r?.paths) && r.paths.length ? r.paths.join("\n") : "(none tagged)"), place),
  );
}
