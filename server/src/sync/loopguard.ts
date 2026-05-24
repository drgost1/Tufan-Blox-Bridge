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
