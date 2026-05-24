import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { listPlaces, resolveTargetPlace, dispatchTo, getSessionByPlace } from "../../bridge/sessions.js";
import { pullPlace } from "../../sync/pull.js";

export function registerPlaceTools(server: McpServer) {
  server.registerTool(
    "list_places",
    {
      description: "List the Roblox Studio places currently connected to the bridge (placeId, name, gameId, project root). Use the placeId or name as the `place` arg on other tools to target a specific one.",
      inputSchema: {},
    },
    async () => {
      const places = listPlaces();
      if (!places.length) return text("(no places connected — open a place in Studio with the Tufan plugin)");
      return text(
        places
          .map((p) => `placeId=${p.placeId}  name="${p.name}"  gameId=${p.gameId ?? "?"}  root=${p.root}`)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "pull_place",
    {
      description: "Re-pull a connected place's full script tree into its local mirror folder (<project>/projects/<name>_<placeId>). Runs automatically on connect; use this to force a refresh.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => {
      const t = resolveTargetPlace(place);
      if (t.error) return errorText(t.error);
      const s = getSessionByPlace(t.placeId!);
      if (!s) return errorText(`Place ${t.placeId} not connected.`);
      if (!s.mirrorRoot) return errorText("This place is unpublished (PlaceId 0) — no local mirror is created for it.");
      try {
        const n = await pullPlace(s);
        return text(`Pulled ${n} scripts -> ${s.mirrorRoot}`);
      } catch (e) {
        return errorText(`pull_place failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "copy_script_across",
    {
      description: "Copy a script's Source from one connected place to another. The headline cross-place op — e.g. push a shared module from one game into another.",
      inputSchema: {
        fromPlace: z.union([z.string(), z.number()]).describe("Source place (PlaceId or name)"),
        sourcePath: z.string().describe("Script path in the source place"),
        toPlace: z.union([z.string(), z.number()]).describe("Destination place (PlaceId or name)"),
        destPath: z.string().optional().describe("Destination script path (defaults to sourcePath)"),
      },
    },
    async ({ fromPlace, sourcePath, toPlace, destPath }) => {
      const from = resolveTargetPlace(fromPlace);
      if (from.error) return errorText(`fromPlace: ${from.error}`);
      const to = resolveTargetPlace(toPlace);
      if (to.error) return errorText(`toPlace: ${to.error}`);

      try {
        const read: any = await dispatchTo(from.placeId!, "getScriptSource", { path: sourcePath });
        const target = destPath ?? sourcePath;
        // upsert: creates the destination script (and any folders) if missing, else updates it
        await dispatchTo(to.placeId!, "applyFileChange", {
          studioPath: target,
          className: read.className ?? "ModuleScript",
          kind: "upsert",
          source: read.source,
        });
        return text(`Copied ${sourcePath} (place ${from.placeId}) -> ${target} (place ${to.placeId}), ${String(read.source).length} bytes`);
      } catch (e) {
        return errorText(`copy_script_across failed: ${(e as Error).message}`);
      }
    },
  );
}
