import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, text, errorText } from "../helpers.js";

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
      description: "Search the Roblox marketplace (Toolbox) for assets. Returns id + name and creator.",
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
      description: "Marketplace details for an asset id: name, creator, type, description, dates. Doesn't say whether a model contains scripts; run scan_backdoors after inserting one.",
      inputSchema: { assetId: z.number() },
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
        "Fetch an asset's thumbnail as a PNG image so the AI can SEE what it looks like before using it. Uses Roblox's public thumbnail API (works for any public asset — no ownership needed, unlike insert_asset). Server-side.",
      inputSchema: {
        assetId: z.number(),
        size: z.enum(["150x150", "420x420", "700x700"]).optional().describe("default 420x420"),
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
      description: "List custom MaterialVariants defined in this place's MaterialService (name + base material), optionally filtered by name. For marketplace assets use search_assets instead; for other existing instances use search_objects/search_by_property.",
      inputSchema: { name: z.string().optional().describe("filter by name substring"), place: placeArg },
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
        "Insert a marketplace asset by id under parentPath (default Workspace). NOTE: Roblox's LoadAsset only authorizes assets the logged-in user OWNS (or Roblox-made ones) — most third-party free models will fail unless you first take them (Toolbox → Add to Inventory). Tip: run scan_backdoors after inserting free models. For a LOCAL file you already have, use import_file instead; to AI-generate a new mesh, use generate_asset instead.",
      inputSchema: { assetId: z.number(), parentPath: z.string().optional(), place: placeArg },
    },
    async ({ assetId, parentPath, place }) =>
      runStudio("insertAsset", { assetId, parentPath: parentPath ?? "Workspace" }, (r) => `Inserted ${r.path}`, place),
  );
}
