import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, text, errorText } from "../helpers.js";

// Roblox toolbox-service: the dev-asset (Model/Decal/Audio/Mesh) marketplace
// behind Studio's Toolbox. Search returns ids; a batch details call adds names.
const CATEGORY: Record<string, number> = { Model: 10, Decal: 13, Audio: 3, Mesh: 40, Plugin: 38 };

async function toolboxDetails(ids: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  if (!ids.length) return out;
  const res = await fetch(`https://apis.roblox.com/toolbox-service/v1/items/details?assetIds=${ids.join(",")}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return out;
  const j: any = await res.json();
  for (const d of j.data ?? []) {
    const a = d.asset;
    if (a?.id) out.set(a.id, { ...a, creator: d.creator });
  }
  return out;
}

export function registerAssetTools(server: McpServer) {
  server.registerTool(
    "search_assets",
    {
      description: "Search the Roblox marketplace (Toolbox) for assets. Returns id + name, and flags assets that contain scripts (⚠ possible backdoor vector). Server-side.",
      inputSchema: {
        keyword: z.string(),
        assetType: z.enum(["Model", "Decal", "Audio", "Mesh", "Plugin"]).optional().describe("default Model"),
        limit: z.number().optional(),
      },
    },
    async ({ keyword, assetType, limit }) => {
      try {
        const cat = CATEGORY[assetType ?? "Model"] ?? 10;
        const n = Math.min(limit ?? 15, 30);
        const sres = await fetch(
          `https://apis.roblox.com/toolbox-service/v1/marketplace/${cat}?keyword=${encodeURIComponent(keyword)}&limit=${n}&pageNumber=1`,
          { headers: { Accept: "application/json" } },
        );
        if (!sres.ok) return errorText(`search_assets: toolbox search HTTP ${sres.status}`);
        const sj: any = await sres.json();
        const ids: number[] = (sj.data ?? []).map((d: any) => d.id).filter(Boolean).slice(0, n);
        if (!ids.length) return text("(no results)");
        const details = await toolboxDetails(ids);
        const lines = ids.map((id) => {
          const a = details.get(id);
          if (!a) return `${id}`;
          const warn = a.hasScripts ? "  ⚠ contains scripts" : "";
          const by = a.creator?.name ? ` — by ${a.creator.name}` : "";
          return `${id}  ${a.name}${by}${warn}`;
        });
        return text(`${ids.length} result(s) for "${keyword}" (${assetType ?? "Model"}):\n` + lines.join("\n"));
      } catch (e) {
        return errorText(`search_assets failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_asset_details",
    {
      description: "Marketplace details for an asset id (name, creator, type, whether it contains scripts, mesh stats).",
      inputSchema: { assetId: z.number() },
    },
    async ({ assetId }) => {
      try {
        const details = await toolboxDetails([assetId]);
        const a = details.get(assetId);
        if (!a) return errorText(`No details for asset ${assetId} (may be rate-limited or invalid).`);
        return text(
          JSON.stringify(
            {
              id: a.id, name: a.name, type: a.assetType ?? a.typeId, description: a.description,
              creator: a.creator?.name, hasScripts: a.hasScripts, createdUtc: a.createdUtc,
              mesh: a.modelTechnicalDetails?.objectMeshSummary,
            },
            null, 2,
          ),
        );
      } catch (e) {
        return errorText(`get_asset_details failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "insert_asset",
    {
      description: "Insert a marketplace asset by id under parentPath (default Workspace). Tip: run scan_backdoors after inserting free models.",
      inputSchema: { assetId: z.number(), parentPath: z.string().optional(), place: placeArg },
    },
    async ({ assetId, parentPath, place }) =>
      runStudio("insertAsset", { assetId, parentPath: parentPath ?? "Workspace" }, (r) => `Inserted ${r.path}`, place),
  );
}
