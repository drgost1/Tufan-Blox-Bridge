// Loop guard — prevents a sync echo: when the server writes a file because
// Studio changed, we mark that path so the chokidar watcher ignores its own
// write instead of pushing it straight back into Studio (and vice versa).

const recentWrites = new Map<string, number>();
const WINDOW_MS = 1500;

export function markServerWrite(absPath: string) {
  recentWrites.set(absPath, Date.now());
}

export function wasJustWrittenByServer(absPath: string): boolean {
  const t = recentWrites.get(absPath);
  if (t === undefined) return false;
  if (Date.now() - t > WINDOW_MS) {
    recentWrites.delete(absPath);
    return false;
  }
  return true;
}

// Content guard — the mirror is chmod'ed read-only on disconnect and writable
// on reconnect, and on Windows that attribute flip fires a chokidar "change"
// for every file. Without this, each disconnect/reconnect pushed every script
// back into Studio, and a push racing a Studio delete re-created the deleted
// script. A file only flows file -> Studio when its CONTENT differs from what
// the server last wrote there (or last pushed from there).
const lastContent = new Map<string, string>();

export function rememberContent(absPath: string, content: string) {
  lastContent.set(absPath, content);
}

export function forgetContent(absPath: string) {
  lastContent.delete(absPath);
}

export function sameAsRemembered(absPath: string, content: string): boolean {
  return lastContent.get(absPath) === content;
}
