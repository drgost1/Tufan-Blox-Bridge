import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerSnapshotTools(server: McpServer) {
  server.registerTool(
    "snapshot",
    {
      description:
        "Checkpoint a subtree before risky changes. Keeps an exact live clone in " +
        "ServerStorage._TufanSnapshots so you can `restore` it later — a real undo across the AI " +
        "boundary, surviving even after Studio's own undo stack has moved on. Handles " +
        "Archivable=false descendants.",
      inputSchema: {
        path: z.string(),
        name: z.string().optional().describe("snapshot name (default: <instance>_<timestamp>)"),
        place: placeArg,
      },
    },
    async ({ path, name, place }) =>
      runStudio("snapshot", { path, name }, (r) => `Snapshot "${r.name}" saved (${r.descendants} descendants; restores to ${r.origParent})`, place),
  );

  server.registerTool(
    "restore",
    {
      description:
        "Restore a snapshot: destroys whatever's currently at its original location and re-clones " +
        "the checkpoint back exactly. One undo entry. Pass parentPath to restore somewhere else.",
      inputSchema: {
        name: z.string(),
        parentPath: z.string().optional().describe("override the original parent"),
        place: placeArg,
      },
    },
    async ({ name, parentPath, place }) =>
      runStudio("restore", { name, parentPath }, (r) => `Restored "${name}" → ${r.path}`, place),
  );

  server.registerTool(
    "list_snapshots",
    { description: "List saved snapshots (name, origin, time, size).", inputSchema: { place: placeArg } },
    async ({ place }) =>
      runStudio("listSnapshots", {}, (r) => {
        const s = r?.snapshots ?? [];
        if (!s.length) return "(no snapshots)";
        return s.map((x: any) => `${x.name}  (${x.className}, ${x.descendants ?? "?"} desc) → ${x.origParent}.${x.origName}`).join("\n");
      }, place),
  );

  server.registerTool(
    "delete_snapshot",
    { description: "Delete a saved snapshot.", inputSchema: { name: z.string(), place: placeArg } },
    async ({ name, place }) => runStudio("deleteSnapshot", { name }, () => `Deleted snapshot "${name}"`, place),
  );
}
