// Git operations, per project root (cached SimpleGit instances).

import { simpleGit, type SimpleGit } from "simple-git";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log as logMsg } from "../util/log.js";

const cache = new Map<string, SimpleGit>();

function gitFor(root: string): SimpleGit {
  let g = cache.get(root);
  if (!g) {
    g = simpleGit({ baseDir: root });
    cache.set(root, g);
  }
  return g;
}

/** Make `root` a git repo if it isn't one yet (each place folder = its own repo). */
export async function ensureGitRepo(root: string): Promise<void> {
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, ".git"))) {
    try {
      await gitFor(root).init();
    } catch {
      // best-effort
    }
  }
}

export async function status(root: string): Promise<string> {
  const s = await gitFor(root).status();
  const lines: string[] = [`On branch ${s.current ?? "(detached)"}`];
  if (s.ahead || s.behind) lines.push(`ahead ${s.ahead}, behind ${s.behind}`);
  if (s.files.length === 0) lines.push("Working tree clean");
  else for (const f of s.files) lines.push(`  ${f.index}${f.working_dir} ${f.path}`);
  return lines.join("\n");
}

export async function commit(root: string, message: string, paths?: string[]): Promise<string> {
  const g = gitFor(root);
  if (paths && paths.length) await g.add(paths);
  else await g.add(".");
  const res = await g.commit(message);
  return `Committed ${res.commit || "(no changes)"} — ${res.summary.changes} changed, +${res.summary.insertions} -${res.summary.deletions}`;
}

export async function log(root: string, count = 20): Promise<string> {
  const l = await gitFor(root).log({ maxCount: count });
  return l.all.map((c) => `${c.hash.slice(0, 8)}  ${c.date.slice(0, 19)}  ${c.message}`).join("\n");
}

export async function diff(root: string, path?: string): Promise<string> {
  const out = await gitFor(root).diff(path ? [path] : []);
  return out || "(no unstaged changes)";
}

export async function restore(root: string, target: string): Promise<string> {
  await gitFor(root).checkout(["--", target]);
  return `Restored ${target} to HEAD`;
}

export async function branch(root: string, name?: string): Promise<string> {
  const g = gitFor(root);
  if (!name) {
    const b = await g.branchLocal();
    return b.all.map((n) => (n === b.current ? `* ${n}` : `  ${n}`)).join("\n");
  }
  await g.checkoutLocalBranch(name);
  return `Created and switched to branch ${name}`;
}

export async function push(root: string): Promise<string> {
  await gitFor(root).push();
  return "pushed to remote";
}

/**
 * Make a single baseline commit if the repo has no commits yet. Called right
 * after the first pull so a freshly-mirrored place is never stuck at 0 commits
 * (its "free safety net" — the initial Studio state is always recoverable).
 * Returns true if it created the baseline.
 */
export async function baselineCommitIfEmpty(root: string): Promise<boolean> {
  try {
    const g = gitFor(root);
    let empty = false;
    try {
      await g.raw(["rev-parse", "--verify", "HEAD"]);
    } catch {
      empty = true; // no commits yet
    }
    if (!empty) return false;
    await g.add(".");
    const res = await g.commit("baseline: initial place mirror");
    if (res.commit) logMsg(`baseline commit ${res.commit} in ${root}`);
    return true;
  } catch {
    return false; // best-effort — never block the connect flow
  }
}

/**
 * If `baseDir` is itself a git repo, make sure its .gitignore excludes the
 * mirror folder. Each place under projects/ is its own repo, so committing
 * them into a parent repo would create embedded-repo (gitlink) pollution.
 * No-op when baseDir isn't a repo or already ignores it.
 */
export function ensureMirrorIgnored(baseDir: string, entry = "projects/"): void {
  try {
    if (!existsSync(join(baseDir, ".git"))) return; // parent isn't a repo — nothing to pollute
    const gi = join(baseDir, ".gitignore");
    const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
    const bare = entry.replace(/\/$/, "");
    const already = current
      .split(/\r?\n/)
      .some((line) => line.trim() === entry || line.trim() === bare);
    if (already) return;
    const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    const block = `${sep}\n# Tufan-Blox-Bridge local mirror (each place is its own git repo)\n${entry}\n`;
    writeFileSync(gi, current + block, "utf8");
    logMsg(`added '${entry}' to ${gi}`);
  } catch {
    // best-effort
  }
}

export async function autoCommit(root: string, relPath: string, alsoPush = false): Promise<void> {
  try {
    const g = gitFor(root);
    await g.add([relPath]);
    await g.commit(`studio: edit ${relPath}`);
    if (alsoPush) {
      try {
        await g.push();
      } catch {
        // no remote / offline — commit still succeeded
      }
    }
  } catch {
    // best-effort
  }
}
