import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, optionalPathArg, text, errorText } from "../helpers.js";

// Roblox toolbox-service: the dev-asset (Model/Decal/Audio/Mesh) marketplace
// behind Studio's Toolbox. Search returns ids; a batch details call adds names.
const CATEGORY: Record<string, number> = { Model: 10, Decal: 13, Audio: 3, Mesh: 40, Plugin: 38 };

// Roblox removed the toolbox details endpoint; the public economy API still answers
// per asset, without saying whether a model contains scripts.
async function assetDetails(ids: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`https://economy.roblox.com/v2/assets/${id}/details`, { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const a: any = await res.json();
        out.set(id, {
          id, name: a.Name, description: a.Description, typeId: a.AssetTypeId,
          creator: a.Creator?.Name, createdUtc: a.Created, updatedUtc: a.Updated,
          isForSale: a.IsForSale, isPublicDomain: a.IsPublicDomain,
        });
      } catch {
        /* one failed lookup shouldn't lose the rest of the search */
      }
    }),
  );
  return out;
}

export function registerAssetTools(server: McpServer) {
  server.registerTool(
    "search_assets",
    {
      description:
        "Search the Roblox Creator Store (Studio's Toolbox) by keyword and list matching asset ids with name and creator. Read-only; calls Roblox's public web APIs and needs no Studio. " +
        "Follow up with get_asset_details or get_asset_thumbnail, then insert_asset. Roblox no longer reports whether a model contains scripts, so run scan_backdoors after inserting a free model. " +
        "To find instances already in the place use search_objects.",
      inputSchema: {
        keyword: z.string().describe('Search words, e.g. "medieval house" or "sword".'),
        assetType: z.enum(["Model", "Decal", "Audio", "Mesh", "Plugin"]).optional().describe("Marketplace category to search. Default Model."),
        limit: z.number().int().min(1).max(30).optional().describe("Maximum results, up to 30. Default 15."),
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
        const details = await assetDetails(ids);
        const lines = ids.map((id) => {
          const a = details.get(id);
          if (!a) return `${id}`;
          const by = a.creator ? ` — by ${a.creator}` : "";
          return `${id}  ${a.name}${by}`;
        });
        return text(
          `${ids.length} result(s) for "${keyword}" (${assetType ?? "Model"}):\n` + lines.join("\n") +
            "\n\nRoblox no longer reports whether a model contains scripts here: run scan_backdoors after inserting a free model.",
        );
      } catch (e) {
        return errorText(`search_assets failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_asset_details",
    {
      description:
        "Fetch public marketplace details for one asset id as JSON: name, creator, asset type, description, created and updated dates, and whether it is for sale. Read-only; uses Roblox's public economy API. " +
        "It does not say whether a model contains scripts, so run scan_backdoors after inserting one. To see the asset, use get_asset_thumbnail.",
      inputSchema: { assetId: z.number().int().describe("Roblox asset id, e.g. from search_assets or a Creator Store URL.") },
    },
    async ({ assetId }) => {
      try {
        const details = await assetDetails([assetId]);
        const a = details.get(assetId);
        if (!a) return errorText(`No details for asset ${assetId} (may be rate-limited or invalid).`);
        return text(JSON.stringify(a, null, 2));
      } catch (e) {
        return errorText(`get_asset_details failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_asset_thumbnail",
    {
      description:
        "Return an asset's thumbnail as a PNG image, so you can see what it looks like before inserting it. Read-only; uses Roblox's public thumbnail API and works for any public asset, owned or not. " +
        "For text details use get_asset_details. This shows catalog art only; to see the open place use the official Studio MCP's screen_capture.",
      inputSchema: {
        assetId: z.number().int().describe("Roblox asset id, e.g. from search_assets."),
        size: z.enum(["150x150", "420x420", "700x700"]).optional().describe("Image size in pixels. Default 420x420."),
      },
    },
    async ({ assetId, size }) => {
      try {
        const sz = size ?? "420x420";
        const meta: any = await fetch(
          `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=${sz}&format=Png&isCircular=false`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
        ).then((r) => r.json());
        const entry = meta?.data?.[0];
        if (!entry?.imageUrl) return errorText(`No thumbnail for ${assetId} (state: ${entry?.state ?? "unknown"}).`);
        const ab = await fetch(entry.imageUrl, { signal: AbortSignal.timeout(10_000) }).then((r) => r.arrayBuffer());
        const buf = Buffer.from(new Uint8Array(ab));
        if (buf.length < 100) return errorText("Thumbnail came back empty.");
        return { content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }] };
      } catch (e) {
        return errorText(`get_asset_thumbnail failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "search_materials",
    {
      description:
        "List the custom MaterialVariants defined in this place's MaterialService, with each one's base material. Read-only. " +
        "Use it to find a material name to set on parts with set_property or mass_edit. For marketplace assets use search_assets; for other instances use search_objects.",
      inputSchema: { name: z.string().optional().describe("Only list variants whose name contains this text. Omit to list all."), place: placeArg },
    },
    async ({ name, place }) =>
      runStudio("searchMaterials", { name: name ?? null }, (r) =>
        Array.isArray(r?.materials) && r.materials.length
          ? r.materials.map((m: any) => `${m.name}  (base: ${m.baseMaterial})`).join("\n")
          : "(no custom MaterialVariants in MaterialService)",
        place,
      ),
  );

  server.registerTool(
    "insert_asset",
    {
      description:
        "Insert a marketplace asset into the edit copy by id and return its path. Recorded as one Studio undo step. " +
        "Roblox only lets Studio load assets the signed-in user owns, or Roblox-made ones, so most third-party free models fail until the user adds them to their inventory in the Toolbox. " +
        "Run scan_backdoors after inserting a free model. For a file on this computer use import_file; to generate a new model with AI use generate_asset.",
      inputSchema: {
        assetId: z.number().int().describe("Roblox asset id, e.g. from search_assets."),
        parentPath: optionalPathArg("Where to put the inserted asset", "Workspace"),
        place: placeArg,
      },
    },
    async ({ assetId, parentPath, place }) =>
      runStudio("insertAsset", { assetId, parentPath: parentPath ?? "Workspace" }, (r) => `Inserted ${r.path}`, place),
  );
}
