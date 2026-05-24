import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText } from "../helpers.js";
import * as git from "../../git/git.js";

function wrap(fn: () => Promise<string>) {
  return async () => {
    try {
      return text(await fn());
    } catch (e) {
      return errorText(`git error: ${(e as Error).message}`);
    }
  };
}

export function registerGitTools(server: McpServer) {
  server.registerTool(
    "git_status",
    { description: "Show working-tree status of the synced project.", inputSchema: {} },
    wrap(() => git.status()),
  );

  server.registerTool(
    "git_commit",
    {
      description: "Stage and commit changes in the project. Commits all changes unless paths[] is given.",
      inputSchema: { message: z.string(), paths: z.array(z.string()).optional() },
    },
    async ({ message, paths }) => {
      try {
        return text(await git.commit(message, paths));
      } catch (e) {
        return errorText(`git commit failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "git_log",
    {
      description: "Show recent commits (default 20).",
      inputSchema: { count: z.number().optional() },
    },
    async ({ count }) => {
      try {
        return text(await git.log(count ?? 20));
      } catch (e) {
        return errorText(`git log failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "git_diff",
    {
      description: "Show the working-tree diff, optionally for a single path.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path }) => {
      try {
        return text(await git.diff(path));
      } catch (e) {
        return errorText(`git diff failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "git_restore",
    {
      description: "Discard working changes for a path, restoring it to HEAD.",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => {
      try {
        return text(await git.restore(path));
      } catch (e) {
        return errorText(`git restore failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "git_branch",
    {
      description: "List branches, or create+switch to a new branch when name is given.",
      inputSchema: { name: z.string().optional() },
    },
    async ({ name }) => {
      try {
        return text(await git.branch(name));
      } catch (e) {
        return errorText(`git branch failed: ${(e as Error).message}`);
      }
    },
  );
}
