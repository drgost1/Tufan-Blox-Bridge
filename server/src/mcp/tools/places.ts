import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText } from "../helpers.js";
import { listPlaces, resolveTargetPlace, dispatchTo } from "../../bridge/sessions.js";

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
