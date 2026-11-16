import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { listPlaces, resolveTargetPlace, dispatchTo, getSessionByPlace } from "../../bridge/sessions.js";
import { pullPlace } from "../../sync/pull.js";

export function registerPlaceTools(server: McpServer) {
  server.registerTool(
    "list_places",
    {
      description:
        "List the Roblox Studio places connected to the bridge right now, with placeId, name, gameId and project folder. Read-only. " +
        "Call it first when several places are open, then pass a placeId or name as the place argument of other tools; with one place open, tools target it automatically. To check a single connection, ping is enough.",
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
      description:
        "Re-read every script in a connected place and rewrite its mirror folder on disk (<project>/projects/<name>_<placeId>) to match Studio. It runs automatically on connect, so use it only when the files look out of date. " +
        "Mirror files are overwritten; when git is on, uncommitted mirror changes are committed first so they can be recovered. Unpublished places (PlaceId 0) have no mirror.",
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
      description:
        "Copy one script's Source from one connected place into another, for example to share a module between two games. Both places must be open in Studio. " +
        "The destination script is overwritten if it exists, or created with any missing folders if it doesn't. Use list_places to get the place names or ids.",
      inputSchema: {
        fromPlace: z.union([z.string(), z.number()]).describe("Place to copy from: its PlaceId or name, as list_places shows."),
        sourcePath: z.string().describe('Dot path of the script in the source place, e.g. "ReplicatedStorage.Shared.Util".'),
        toPlace: z.union([z.string(), z.number()]).describe("Place to copy into: its PlaceId or name, as list_places shows."),
        destPath: z.string().optional().describe("Dot path for the script in the destination place. Defaults to the same path as sourcePath."),
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
