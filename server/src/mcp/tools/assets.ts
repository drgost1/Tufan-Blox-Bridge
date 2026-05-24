import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, text, errorText } from "../helpers.js";

// Catalog search runs server-side (HttpService can't reach roblox.com from a
// plugin). Best-effort against the public catalog API; insert runs in Studio.
async function catalogSearch(keyword: string, limit: number): Promise<string> {
  const url = `https://catalog.roblox.com/v1/search/items/details?Keyword=${encodeURIComponent(keyword)}&Limit=${Math.min(limit, 30)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catalog API ${res.status}`);
  const data: any = await res.json();
  const items = data?.data ?? [];
  if (!items.length) return "(no results)";
  return items.map((i: any) => `${i.id}  ${i.name} (${i.itemType ?? "?"})`).join("\n");
}

export function registerAssetTools(server: McpServer) {
  server.registerTool(
    "search_assets",
    {
      description: "Search the Roblox marketplace catalog (server-side). Returns id + name.",
      inputSchema: { keyword: z.string(), limit: z.number().optional() },
    },
    async ({ keyword, limit }) => {
      try {
        return text(await catalogSearch(keyword, limit ?? 20));
      } catch (e) {
        return errorText(`search_assets failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_asset_details",
    {
      description: "Get marketplace details for an asset id (server-side).",
      inputSchema: { assetId: z.number() },
    },
    async ({ assetId }) => {
      try {
        const res = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`);
        if (!res.ok) throw new Error(`economy API ${res.status}`);
        return text(JSON.stringify(await res.json(), null, 2));
      } catch (e) {
        return errorText(`get_asset_details failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "insert_asset",
    {
      description: "Insert a marketplace asset by id under parentPath (default Workspace).",
      inputSchema: { assetId: z.number(), parentPath: z.string().optional(), place: placeArg },
    },
    async ({ assetId, parentPath, place }) =>
      runStudio("insertAsset", { assetId, parentPath: parentPath ?? "Workspace" }, (r) => `Inserted ${r.path}`, place),
  );
}
