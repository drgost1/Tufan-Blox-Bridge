import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, pathArg } from "../helpers.js";

export function registerSnapshotTools(server: McpServer) {
  server.registerTool(
    "snapshot",
    {
      description:
        "Checkpoint an instance and everything under it before a risky edit, so `restore` can put it back exactly. " +
        "Stores a live clone in ServerStorage._TufanSnapshots, which survives after Studio's undo stack has moved on and is saved with the place. " +
        "Saving under an existing snapshot name replaces that snapshot. Archivable=false descendants are included. " +
        "Use this for instances in the place; for script files on disk use git_commit, and for GUIs or models lost to a delete use restore_from_mirror.",
      inputSchema: {
        path: pathArg("Instance to checkpoint (its whole subtree is copied)"),
        name: z.string().optional().describe("Snapshot name. Defaults to <InstanceName>_<unix time>. An existing snapshot with this name is replaced."),
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
        "Put a `snapshot` checkpoint back: destroys the child with the original name under the original parent, then clones the checkpoint into its place. " +
        "Recorded as one Studio undo step, and the snapshot is kept so you can restore it again. " +
        "Use list_snapshots to find names. For script files tracked in git use git_restore or git_recover; for instances saved by the disk mirror use restore_from_mirror.",
      inputSchema: {
        name: z.string().describe("Snapshot name, as shown by list_snapshots."),
        parentPath: z.string().optional().describe('Restore under this parent instead of the original one (dot path, e.g. "ServerStorage.Backup"). The first child there with the original name is replaced.'),
        place: placeArg,
      },
    },
    async ({ name, parentPath, place }) =>
      runStudio("restore", { name, parentPath }, (r) => `Restored "${name}" → ${r.path}`, place),
  );

  server.registerTool(
    "list_snapshots",
    {
      description:
        "List the snapshots saved in this place: name, class, descendant count and the path each one restores to. " +
        "Read-only. Call it before restore or delete_snapshot to get the exact name; returns \"(no snapshots)\" when there are none.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) =>
      runStudio("listSnapshots", {}, (r) => {
        const s = r?.snapshots ?? [];
        if (!s.length) return "(no snapshots)";
        return s.map((x: any) => `${x.name}  (${x.className}, ${x.descendants ?? "?"} desc) → ${x.origParent}.${x.origName}`).join("\n");
      }, place),
  );

  server.registerTool(
    "delete_snapshot",
    {
      description:
        "Permanently delete one saved snapshot from ServerStorage._TufanSnapshots to free space or tidy up. " +
        "Only the checkpoint is removed; the live instance it was taken from is not touched. The deletion is not recorded as a Studio undo step, so treat it as final. " +
        "Fails if no snapshot has that name; use list_snapshots to check names first.",
      inputSchema: { name: z.string().describe("Exact snapshot name, as shown by list_snapshots."), place: placeArg },
    },
    async ({ name, place }) => runStudio("deleteSnapshot", { name }, () => `Deleted snapshot "${name}"`, place),
  );
}
