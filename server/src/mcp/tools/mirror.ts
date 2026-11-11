import { z } from "zod";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { resolveTargetPlace, getSessionByPlace, dispatchTo } from "../../bridge/sessions.js";
import { listMirrorUnits, restoreCandidates } from "../../sync/instanceMirror.js";
import { longPath, readHistory } from "../../sync/history.js";

function mirrorFor(place?: string | number): { root?: string; placeId?: number; error?: string } {
  const t = resolveTargetPlace(place);
  if (t.error) return { error: t.error };
  const s = getSessionByPlace(t.placeId!);
  if (!s) return { error: `Place ${t.placeId} not connected.` };
  if (!s.mirrorRoot) return { error: "This place has no local mirror (unpublished place, or still connecting)." };
  return { root: s.mirrorRoot, placeId: t.placeId };
}

function when(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function registerMirrorTools(server: McpServer) {
  server.registerTool(
    "mirror_history",
    {
      description:
        "What the on-disk mirror can bring back. The plugin saves every direct child of StarterGui, " +
        "ReplicatedStorage, ServerStorage, StarterPack and Lighting as a .rbxm next to the script files " +
        "(seconds after a change), and keeps a frozen copy in .history whenever one is removed, loses " +
        "descendants (a delete or Ctrl+Z) or is overwritten after a quiet spell; scripts get the same. " +
        "Lists the live mirror files and the history copies whose path matches `path` (a unit or anything " +
        "inside it). Restore one with restore_from_mirror.",
      inputSchema: {
        path: z.string().optional().describe("Studio path or part of one, e.g. StarterGui.MineGui (omit for everything)"),
        limit: z.number().int().min(1).max(500).optional().describe("max history rows (default 40)"),
        place: placeArg,
      },
    },
    async ({ path, limit, place }) => {
      const m = mirrorFor(place);
      if (m.error) return errorText(m.error);
      const needle = (path ?? "").replace(/^game\./i, "").toLowerCase();
      const matches = (p: string) => {
        if (!needle) return true;
        const lower = p.toLowerCase();
        // the path itself, anything inside it, or a unit that holds it; a bare
        // word without dots also matches as a substring (e.g. "mine")
        return lower === needle || lower.startsWith(needle + ".") || needle.startsWith(lower + ".") ||
          (!needle.includes(".") && lower.includes(needle));
      };
      const units = listMirrorUnits(m.root!).filter((u) => matches(u.studioPath));
      const hist = readHistory(m.root!)
        .filter((e) => matches(e.studioPath))
        .sort((a, b) => b.t - a.t)
        .slice(0, limit ?? 40);
      const lines: string[] = [];
      lines.push(`Mirror: ${m.root}`);
      lines.push(`Live mirror files (${units.length}):`);
      for (const u of units.slice(0, 200)) lines.push(`  ${u.studioPath}  ${kb(u.bytes)}  saved ${when(u.mtime)}`);
      if (units.length > 200) lines.push(`  ... ${units.length - 200} more`);
      lines.push(`History copies (${hist.length}${hist.length === (limit ?? 40) ? "+" : ""}, newest first; version = the stamp):`);
      for (const e of hist) lines.push(`  ${when(e.t)}  ${e.studioPath}  [${e.kind}, ${e.reason}, ${kb(e.bytes)}]  version=${e.stamp}`);
      if (!hist.length) lines.push("  (none)");
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "restore_from_mirror",
    {
      description:
        "Bring one instance back into the edit copy from the on-disk mirror or its .history, by Studio path " +
        "(e.g. StarterGui.MineGui, StarterGui.FarmGui.Toasts, ReplicatedStorage.Mining.SomeModule). Works for " +
        "anything inside a mirrored unit and for scripts. Without `version` it tries the live mirror file first, " +
        "then history copies newest first, and uses the first one that still holds the path. One undo entry. " +
        "Refuses to overwrite an existing same-named instance unless replace=true. Use mirror_history to pick a version.",
      inputSchema: {
        path: z.string().describe("Studio path of the instance to restore"),
        version: z.string().optional().describe("history stamp from mirror_history, or 'current' for the live mirror file only"),
        parentPath: z.string().optional().describe("put it under this parent instead of its original spot"),
        replace: z.boolean().optional().describe("destroy an existing instance with the same name and class first"),
        place: placeArg,
      },
    },
    async ({ path, version, parentPath, replace, place }) => {
      const m = mirrorFor(place);
      if (m.error) return errorText(m.error);
      const candidates = restoreCandidates(m.root!, path, version).slice(0, 40);
      if (!candidates.length) {
        return errorText(`Nothing in the mirror or its history holds ${path}${version ? ` (version ${version})` : ""}. Check mirror_history.`);
      }
      let tried = 0;
      for (const c of candidates) {
        tried++;
        let args: Record<string, unknown>;
        try {
          if (c.kind === "script") {
            args = { kind: "script", studioPath: c.studioPath, className: c.className, source: readFileSync(longPath(c.file), "utf8"), parentPath, replace };
          } else {
            args = { kind: "rbxm", data: readFileSync(longPath(c.file)).toString("base64"), service: c.service, unitName: c.unitName, subPath: c.subPath, parentPath, replace };
          }
        } catch (e) {
          continue; // unreadable copy, try the next
        }
        let r: any;
        try {
          r = await dispatchTo(m.placeId!, "restoreFromMirror", args, 60_000);
        } catch (e) {
          return errorText(`restore failed: ${(e as Error).message}`);
        }
        if (r?.found === false) continue;
        const from = c.source === "mirror" ? "the live mirror file" : `history copy ${c.stamp} (${c.reason}${c.t ? `, ${when(c.t)}` : ""})`;
        return text(
          `Restored ${r.path} (${r.className}, ${r.descendants} descendants) from ${from}` +
            (r.replaced ? "; replaced the existing one" : "") +
            (tried > 1 ? `. Skipped ${tried - 1} newer copies that didn't hold it.` : "."),
        );
      }
      return errorText(`${path} isn't inside any of the ${tried} mirror/history copies checked. Check mirror_history for the unit.`);
    },
  );
}
