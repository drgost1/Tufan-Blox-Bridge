// Git operations, run in the project root via simple-git.

import { simpleGit, type SimpleGit } from "simple-git";

let git: SimpleGit | null = null;
let root = process.cwd();

export function initGit(projectRoot: string) {
  root = projectRoot;
  git = simpleGit({ baseDir: projectRoot });
}

function ensure(): SimpleGit {
  if (!git) git = simpleGit({ baseDir: root });
  return git;
}

export async function status(): Promise<string> {
  const s = await ensure().status();
  const lines: string[] = [];
  lines.push(`On branch ${s.current ?? "(detached)"}`);
  if (s.ahead || s.behind) lines.push(`ahead ${s.ahead}, behind ${s.behind}`);
  if (s.files.length === 0) {
    lines.push("Working tree clean");
  } else {
    for (const f of s.files) lines.push(`  ${f.index}${f.working_dir} ${f.path}`);
  }
  return lines.join("\n");
}

export async function commit(message: string, paths?: string[]): Promise<string> {
  const g = ensure();
  if (paths && paths.length) await g.add(paths);
  else await g.add(".");
  const res = await g.commit(message);
  return `Committed ${res.commit || "(no changes)"} — ${res.summary.changes} changed, +${res.summary.insertions} -${res.summary.deletions}`;
}

export async function log(count = 20): Promise<string> {
  const l = await ensure().log({ maxCount: count });
  return l.all
    .map((c) => `${c.hash.slice(0, 8)}  ${c.date.slice(0, 19)}  ${c.message}`)
    .join("\n");
}

export async function diff(path?: string): Promise<string> {
  const args = path ? [path] : [];
  const out = await ensure().diff(args);
  return out || "(no unstaged changes)";
}

export async function restore(target: string): Promise<string> {
  // target is a path (discard working changes) — use checkout -- <path>
  await ensure().checkout(["--", target]);
  return `Restored ${target} to HEAD`;
}

export async function branch(name?: string): Promise<string> {
  const g = ensure();
  if (!name) {
    const b = await g.branchLocal();
    return b.all.map((n) => (n === b.current ? `* ${n}` : `  ${n}`)).join("\n");
  }
  await g.checkoutLocalBranch(name);
  return `Created and switched to branch ${name}`;
}

export async function autoCommit(relPath: string): Promise<void> {
  try {
    const g = ensure();
    await g.add([relPath]);
    await g.commit(`studio: edit ${relPath}`);
  } catch {
    // auto-commit is best-effort; never throw into the sync path
  }
}
