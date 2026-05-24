import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText } from "../helpers.js";
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
  return { root: s.root };
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
    { description: "Working-tree diff, optionally for one path.", inputSchema: { path: z.string().optional(), place: placeArg } },
    async ({ path, place }) => withRoot(place, (root) => git.diff(root, path)),
  );

  server.registerTool(
    "git_restore",
    { description: "Discard working changes for a path (restore to HEAD).", inputSchema: { path: z.string(), place: placeArg } },
    async ({ path, place }) => withRoot(place, (root) => git.restore(root, path)),
  );

  server.registerTool(
    "git_branch",
    { description: "List branches, or create+switch when name given.", inputSchema: { name: z.string().optional(), place: placeArg } },
    async ({ name, place }) => withRoot(place, (root) => git.branch(root, name)),
  );
}
