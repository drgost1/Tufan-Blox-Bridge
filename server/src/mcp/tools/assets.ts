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
      description: "List custom MaterialVariants defined in this place's MaterialService (name + base material), optionally filtered by name.",
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
        "Insert a marketplace asset by id under parentPath (default Workspace). NOTE: Roblox's LoadAsset only authorizes assets the logged-in user OWNS (or Roblox-made ones) — most third-party free models will fail unless you first take them (Toolbox → Add to Inventory). Tip: run scan_backdoors after inserting free models.",
      inputSchema: { assetId: z.number(), parentPath: z.string().optional(), place: placeArg },
    },
    async ({ assetId, parentPath, place }) =>
      runStudio("insertAsset", { assetId, parentPath: parentPath ?? "Workspace" }, (r) => `Inserted ${r.path}`, place),
  );
}
