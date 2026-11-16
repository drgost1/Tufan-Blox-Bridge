import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, requireWritable } from "../helpers.js";
import { resolveTargetPlace, getSessionByPlace } from "../../bridge/sessions.js";
import * as git from "../../git/git.js";

const placeArg = z
  .union([z.string(), z.number()])
  .optional()
  .describe("Target place (PlaceId or project name) whose mirror repo to use. Defaults to the bound/sole connected place.");

const FILE_PATH = 'File path relative to the mirror folder, as git_status or git_log prints it, e.g. "ServerScriptService/Main.server.luau".';

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
    {
      description:
        "Show the git status of a place's mirror repo: current branch, commits ahead or behind the remote, and each changed file. Read-only. " +
        "Run it before git_commit to see what will be committed, or before git_pull to make sure nothing is uncommitted. For line-level changes use git_diff.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => withRoot(place, (root) => git.status(root)),
  );

  server.registerTool(
    "git_commit",
    {
      description:
        "Stage and commit changes in a place's mirror repo, creating a restore point for scripts and saved instances. Only adds history; nothing is overwritten. " +
        "Commits every change unless paths is given. Commit before risky edits so git_restore, git_revert and git_recover have something to go back to; git_push then copies it off this machine.",
      inputSchema: {
        message: z.string().describe("Commit message describing the change."),
        paths: z.array(z.string()).optional().describe(`Commit only these files. ${FILE_PATH} Omit to commit everything that changed.`),
        place: placeArg,
      },
    },
    async ({ message, paths, place }) => withRoot(place, (root) => git.commit(root, message, paths)),
  );

  server.registerTool(
    "git_log",
    {
      description:
        "List recent commits in a place's mirror repo, newest first: short hash, date and message. Read-only; says so when there are no commits yet. " +
        "Use it to find the ref for git_show, git_diff, git_restore or git_revert.",
      inputSchema: {
        count: z.number().int().min(1).optional().describe("How many commits to list. Default 20."),
        place: placeArg,
      },
    },
    async ({ count, place }) => withRoot(place, (root) => git.log(root, count ?? 20)),
  );

  server.registerTool(
    "git_diff",
    {
      description:
        "Show a unified diff in a place's mirror repo. Read-only. With no refs it shows uncommitted changes; with from it compares that commit to the working files; with from and to it compares two commits. " +
        "For a commit's summary use git_show; for which files changed use git_status.",
      inputSchema: {
        path: z.string().optional().describe(`Limit the diff to one file. ${FILE_PATH}`),
        from: z.string().optional().describe('Starting commit or ref, e.g. "HEAD~1" or a hash. Omit to diff uncommitted changes against HEAD.'),
        to: z.string().optional().describe('Ending commit or ref, e.g. "HEAD". Only used together with from.'),
        place: placeArg,
      },
    },
    async ({ path, from, to, place }) => withRoot(place, (root) => git.diff(root, path, from, to)),
  );

  server.registerTool(
    "git_restore",
    {
      description:
        "Overwrite one file in the mirror with its committed version: HEAD by default, or an older commit given as source. Uncommitted edits to that file are lost and cannot be recovered, so check git_diff first. " +
        "The file sync then carries the restored script into Studio. For a file that was deleted use git_recover; for instances checkpointed in the place use restore.",
      inputSchema: {
        path: z.string().describe(FILE_PATH),
        source: z.string().optional().describe('Commit or ref to take the file from, e.g. a hash or "HEAD~3". Omit to discard uncommitted changes and return to HEAD.'),
        place: placeArg,
      },
    },
    async ({ path, source, place }) => withRoot(place, (root) => git.restore(root, path, source)),
  );

  server.registerTool(
    "git_recover",
    {
      description:
        "Bring back a deleted file: searches all history for the last commit where the file still had content and writes it back into the mirror. " +
        "Use it when a script is gone and you don't know which commit had it; if you know the commit, git_restore with source does the same. Says so if the file was never committed.",
      inputSchema: {
        path: z.string().describe(`Path of the lost file. ${FILE_PATH} It must match the path it was committed under.`),
        place: placeArg,
      },
    },
    async ({ path, place }) => withRoot(place, (root) => git.recoverFile(root, path)),
  );

  server.registerTool(
    "git_show",
    {
      description:
        "Show one commit's author, date, message and changed-file summary, or, with path, the full content of one file as it was in that commit. Read-only. " +
        "Use it to inspect an old version before restoring it with git_restore. For line-by-line changes use git_diff.",
      inputSchema: {
        ref: z.string().describe('Commit to show: a hash, "HEAD", "HEAD~2", a tag or a branch name.'),
        path: z.string().optional().describe(`Show this file's content at ref instead of the commit summary. ${FILE_PATH}`),
        place: placeArg,
      },
    },
    async ({ ref, path, place }) => withRoot(place, (root) => git.show(root, ref, path)),
  );

  server.registerTool(
    "git_revert",
    {
      description:
        "Undo one earlier commit by adding a new commit with the opposite changes; history is kept, and the files in the mirror change accordingly. " +
        "Use it to roll back a bad change that is already committed. Fails on a merge conflict. To undo uncommitted edits to one file, use git_restore instead.",
      inputSchema: { ref: z.string().describe('Commit to undo: a hash from git_log, or e.g. "HEAD" for the latest.'), place: placeArg },
    },
    async ({ ref, place }) => withRoot(place, (root) => git.revert(root, ref)),
  );

  server.registerTool(
    "git_branch",
    {
      description:
        "List the local branches of a place's mirror repo (current one marked *), or create a new branch from the current commit and switch to it. " +
        "Listing is read-only; creating is blocked in read-only mode. Uncommitted changes carry over to the new branch.",
      inputSchema: {
        name: z.string().optional().describe("Name of a new branch to create and switch to. Omit to list branches."),
        place: placeArg,
      },
    },
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
      description:
        "List the git remotes of a place's mirror repo, or add one. Adding a remote such as a private GitHub repo lets git_push keep a copy off this machine. " +
        "Adding is blocked in read-only mode and fails if the name already exists.",
      inputSchema: {
        action: z.enum(["list", "add"]).optional().describe('"list" (default) shows remotes; "add" needs name and url.'),
        name: z.string().optional().describe('Remote name for add, usually "origin".'),
        url: z.string().optional().describe("Remote URL for add, e.g. https://github.com/you/my-place.git."),
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
    {
      description:
        "Push the current branch's commits to its remote, as an off-machine backup of the place's scripts and saved instances. " +
        "Sends data to the remote (for example GitHub) using your local git credentials. Needs a remote with an upstream branch: add one with git_remote first. Commit with git_commit before pushing.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => withRoot(place, (root) => git.push(root)),
  );

  server.registerTool(
    "git_pull",
    {
      description:
        "Fetch the remote's commits and merge them into the mirror, for example to restore a place's files on a new machine. " +
        "Merged changes overwrite files in the mirror, and the file sync carries them into Studio. Commit or check git_status first; a conflict stops the merge.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) => withRoot(place, (root) => git.pull(root)),
  );
}
