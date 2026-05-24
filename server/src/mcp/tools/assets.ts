import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerAssetTools(server: McpServer) {
  server.registerTool(
    "search_assets",
    {
      description: "Search the Roblox creator marketplace for assets (models/decals/etc). Returns id + name.",
      inputSchema: {
        keyword: z.string(),
        assetType: z.string().optional().describe("e.g. 'Model', 'Decal', 'Audio'"),
        limit: z.number().optional(),
      },
    },
    async ({ keyword, assetType, limit }) =>
      runStudio("searchAssets", { keyword, assetType: assetType ?? null, limit: limit ?? 20 }, (r) =>
        Array.isArray(r?.results) && r.results.length
          ? r.results.map((a: any) => `${a.id}  ${a.name}`).join("\n")
          : "(no results)",
      ),
  );

  server.registerTool(
    "get_asset_details",
    {
      description: "Get details for a marketplace asset by id.",
      inputSchema: { assetId: z.number() },
    },
    async ({ assetId }) => runStudio("getAssetDetails", { assetId }),
  );

  server.registerTool(
    "insert_asset",
    {
      description: "Insert a marketplace asset by id under parentPath (defaults to Workspace).",
      inputSchema: { assetId: z.number(), parentPath: z.string().optional() },
    },
    async ({ assetId, parentPath }) =>
      runStudio("insertAsset", { assetId, parentPath: parentPath ?? "Workspace" }, (r) => `Inserted ${r.path}`),
  );
}
