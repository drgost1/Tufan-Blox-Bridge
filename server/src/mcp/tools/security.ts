import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { runStudio, placeArg, text, errorText } from "../helpers.js";

export function registerSecurityTools(server: McpServer) {
  server.registerTool(
    "scan_backdoors",
    {
      description:
        "Tufan Power Tool: deep-scan a place for backdoors / exploits / obfuscation. Checks script source (require-of-Value, require-by-asset-id, loadstring, HttpGet, getfenv, exploit APIs, Discord webhooks, anti-debug, high-entropy blobs) AND the spots a script-only scanner misses — instance attributes and StringValues hiding encoded payloads. Findings sorted high→low severity. NOTE: this scans the PLACE tree; it cannot read installed Studio plugins' own source (a Roblox limit) — use list_studio_plugins to see what plugins are installed (the remote-code-plugin vector).",
      inputSchema: {
        rootPath: z.string().optional().describe("Limit scan to a subtree (default: whole place)"),
        severity: z.enum(["high", "medium", "low"]).optional().describe("Only show findings at/above this severity"),
        place: placeArg,
      },
    },
    async ({ rootPath, severity, place }) =>
      runStudio("scanBackdoors", { rootPath: rootPath ?? "game" }, (r) => {
        let findings = r?.findings ?? [];
        if (severity) {
          const rank: Record<string, number> = { high: 1, medium: 2, low: 3 };
          findings = findings.filter((f: any) => (rank[f.severity] ?? 9) <= (rank[severity] ?? 9));
        }
        const scanned = r?.scanned ?? 0;
        if (!findings.length) return `Scanned ${scanned} scripts (+ attributes & values) — no suspicious patterns found. ✅`;

        const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
        for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

        const lines = findings.slice(0, 200).map((f: any) => {
          const where = f.detail ? ` (${f.detail})` : "";
          const snip = f.snippet ? `\n    ${f.snippet}` : "";
          return `[${f.severity.toUpperCase()}] {${f.category}} ${f.path}${where} — ${f.label}${snip}`;
        });
        const more = findings.length > 200 ? `\n… +${findings.length - 200} more` : "";
        return `Scanned ${scanned} scripts (+ attributes & values).\nFindings: ${counts.high} high, ${counts.medium} medium, ${counts.low} low.\n\n${lines.join("\n")}${more}`;
      }, place),
  );

  // Installed plugins live on disk, NOT in the place DataModel — a place scan
  // can't see them. This surfaces what's actually installed (e.g. a plugin that
  // loads remote code) by reading Studio's local plugin folders server-side.
  server.registerTool(
    "list_studio_plugins",
    {
      description:
        "List Studio plugins installed locally on this machine (local .rbxm plugins + marketplace InstalledPlugins). Use this to spot the blind spot scan_backdoors can't reach: a third-party plugin running remote code. Server-side; no Studio call.",
      inputSchema: {},
    },
    async () => {
      try {
        const dirs = pluginDirs();
        const out: string[] = [];
        for (const dir of dirs) {
          if (!existsSync(dir)) continue;
          out.push(`\n# ${dir}`);
          let entries: string[];
          try {
            entries = readdirSync(dir);
          } catch {
            out.push("  (unreadable)");
            continue;
          }
          if (!entries.length) {
            out.push("  (empty)");
            continue;
          }
          for (const name of entries) {
            const full = join(dir, name);
            let st;
            try {
              st = statSync(full);
            } catch {
              continue;
            }
            if (st.isDirectory()) {
              // marketplace plugins: <assetId>/ — try to surface a friendly name
              const label = readInstalledName(full);
              out.push(`  📦 ${name}${label ? `  — ${label}` : ""}  (installed plugin)`);
            } else {
              const kb = (st.size / 1024).toFixed(0);
              out.push(`  📄 ${name}  (${kb} KB, ${st.mtime.toISOString().slice(0, 10)})`);
            }
          }
        }
        if (!out.length) return text("No local plugin folders found (none installed, or non-standard path).");
        return text(
          "Installed Studio plugins (review anything you don't recognize — a plugin can run arbitrary code):" +
            out.join("\n"),
        );
      } catch (e) {
        return errorText(`list_studio_plugins failed: ${(e as Error).message}`);
      }
    },
  );
}

function pluginDirs(): string[] {
  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return [join(la, "Roblox", "Plugins"), join(la, "Roblox", "InstalledPlugins")];
  }
  const docs = join(homedir(), "Documents", "Roblox");
  return [join(docs, "Plugins"), join(docs, "InstalledPlugins")];
}

// Marketplace plugins install under <assetId>/; some carry a manifest with a name.
function readInstalledName(dir: string): string | null {
  for (const f of ["manifest.json", "metadata.json", "info.json"]) {
    const p = join(dir, f);
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8"));
        if (typeof j?.name === "string") return j.name;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
