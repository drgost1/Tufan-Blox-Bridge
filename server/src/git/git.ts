// Git operations, per project root (cached SimpleGit instances).

import { simpleGit, type SimpleGit } from "simple-git";

const cache = new Map<string, SimpleGit>();

function gitFor(root: string): SimpleGit {
  let g = cache.get(root);
  if (!g) {
    g = simpleGit({ baseDir: root });
    cache.set(root, g);
  }
  return g;
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

export async function autoCommit(root: string, relPath: string): Promise<void> {
  try {
    const g = gitFor(root);
    await g.add([relPath]);
    await g.commit(`studio: edit ${relPath}`);
  } catch {
    // best-effort
  }
}
