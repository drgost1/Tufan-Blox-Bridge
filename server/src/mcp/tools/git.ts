import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, requireWritable } from "../helpers.js";
import { resolveTargetPlace, getSessionByPlace } from "../../bridge/sessions.js";
import * as git from "../../git/git.js";

const placeArg = z
  .union([z.string(), z.number()])
  .optional()
  .describe("Target place (PlaceId or project name); defaults to the bound/sole place");

// Resolve the git root for a target place.
function rootFor(place?: string | number): { root?: string; error?: string } {
  const t = resolveTargetPlace(place);
  if (t.error) return { error: t.error };
  const s = getSessionByPlace(t.placeId!);
  if (!s) return { error: `Place ${t.placeId} not connected.` };
  // git operates on the per-place mirror repo (falls back to legacy root)
  return { root: s.mirrorRoot ?? s.root };
}

async function withRoot(place: string | number | undefined, fn: (root: string) => Promise<string>) {
  const r = rootFor(place);
  if (r.error) return errorText(r.error);
  try {
    return text(await fn(r.root!));
  } catch (e) {
    return errorText(`git error: ${(e as Error).message}`);
  }
}

export function registerGitTools(server: McpServer) {
  server.registerTool(
    "git_status",
    { description: "Working-tree status of a project.", inputSchema: { place: placeArg } },
    async ({ place }) => withRoot(place, (root) => git.status(root)),
  );

  server.registerTool(
    "git_commit",
    {
      description: "Stage and commit changes in a project (all changes unless paths[] given).",
      inputSchema: { message: z.string(), paths: z.array(z.string()).optional(), place: placeArg },
    },
    async ({ message, paths, place }) => withRoot(place, (root) => git.commit(root, message, paths)),
  );

  server.registerTool(
    "git_log",
    { description: "Recent commits (default 20).", inputSchema: { count: z.number().optional(), place: placeArg } },
    async ({ count, place }) => withRoot(place, (root) => git.log(root, count ?? 20)),
  );

  server.registerTool(
    "git_diff",
    {
      description: "Diff. Default = working tree. Give from/to to compare commits/refs (e.g. from 'HEAD~1' to 'HEAD', or from a commit hash). Optionally scope to one path.",
      inputSchema: { path: z.string().optional(), from: z.string().optional(), to: z.string().optional(), place: placeArg },
    },
    async ({ path, from, to, place }) => withRoot(place, (root) => git.diff(root, path, from, to)),
  );

  server.registerTool(
    "git_restore",
    {
      description: "Restore a file. Without source: discard working changes (restore to HEAD). With source (a commit/ref): recover that OLDER version of the file — use this to get back an edit you lost.",
      inputSchema: { path: z.string(), source: z.string().optional().describe("commit/ref to restore the file FROM (e.g. a hash or HEAD~3)"), place: placeArg },
    },
    async ({ path, source, place }) => withRoot(place, (root) => git.restore(root, path, source)),
  );

  server.registerTool(
    "git_recover",
    {
      description: "Recover a DELETED / lost file: finds the most recent commit where it still had content and restores it. The one-shot 'get my script back' tool.",
      inputSchema: { path: z.string().describe("the Studio-path-style file path that was lost"), place: placeArg },
    },
    async ({ path, place }) => withRoot(place, (root) => git.recoverFile(root, path)),
  );

  server.registerTool(
    "git_show",
    {
      description: "Show a commit (metadata + changed-file stat) by ref, or a file's exact content at that ref when path is given.",
      inputSchema: { ref: z.string().describe("commit hash, HEAD, HEAD~2, tag, branch…"), path: z.string().optional(), place: placeArg },
    },
    async ({ ref, path, place }) => withRoot(place, (root) => git.show(root, ref, path)),
  );

  server.registerTool(
    "git_revert",
    {
      description: "Revert a commit — creates a new commit that undoes it (safe, keeps history). Use to roll back a bad change.",
      inputSchema: { ref: z.string().describe("commit to revert"), place: placeArg },
    },
    async ({ ref, place }) => withRoot(place, (root) => git.revert(root, ref)),
  );

  server.registerTool(
    "git_branch",
    { description: "List branches, or create+switch when name given.", inputSchema: { name: z.string().optional(), place: placeArg } },
    async ({ name, place }) => {
      // Listing branches is a read; creating/switching (name given) is a write.
      if (name) {
        const ro = requireWritable();
        if (ro) return ro;
      }
      return withRoot(place, (root) => git.branch(root, name));
    },
  );

  server.registerTool(
    "git_remote",
    {
      description: "List remotes, or add one (action:'add' + name + url). Add a GitHub remote to back the place mirror up OFF-machine — the local mirror alone dies with the disk.",
      inputSchema: {
        action: z.enum(["list", "add"]).optional(),
        name: z.string().optional().describe("remote name, e.g. 'origin'"),
        url: z.string().optional().describe("remote URL, e.g. a GitHub repo"),
        place: placeArg,
      },
    },
    async ({ action, name, url, place }) => {
      // Listing remotes is a read; adding one is a write.
      if ((action ?? "list") === "add") {
        const ro = requireWritable();
        if (ro) return ro;
      }
      return withRoot(place, (root) => git.remote(root, action ?? "list", name, url));
    },
  );

  server.registerTool(
    "git_push",
    { description: "Push commits to the remote (set one up first with git_remote add). Off-machine backup.", inputSchema: { place: placeArg } },
    async ({ place }) => withRoot(place, (root) => git.push(root)),
  );

  server.registerTool(
    "git_pull",
    { description: "Pull from the remote (fetch + merge). Restore/sync a mirror from its off-machine backup.", inputSchema: { place: placeArg } },
    async ({ place }) => withRoot(place, (root) => git.pull(root)),
  );
}
