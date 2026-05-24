import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerSecurityTools(server: McpServer) {
  server.registerTool(
    "scan_backdoors",
    {
      description:
        "Tufan Power Tool: deep-scan a place for backdoors / exploits / obfuscation. Checks script source (require-of-Value, loadstring, HttpGet, getfenv, exploit APIs, Discord webhooks, anti-debug, high-entropy blobs) AND the spots a script-only scanner misses — instance attributes and StringValues hiding encoded payloads. Findings sorted high→low severity. Run on any place that imported free models.",
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
}
