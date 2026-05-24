import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerSecurityTools(server: McpServer) {
  server.registerTool(
    "scan_backdoors",
    {
      description:
        "Tufan Power Tool: scan every script in the place for known backdoor / exploit patterns (require-of-Value, getfenv, loadstring+HttpGet, obfuscation, exploit APIs). Returns findings sorted high→low severity. Run this on any place that imported free models.",
      inputSchema: {
        rootPath: z.string().optional().describe("Limit scan to a subtree (default: whole place)"),
        place: placeArg,
      },
    },
    async ({ rootPath, place }) =>
      runStudio("scanBackdoors", { rootPath: rootPath ?? "game" }, (r) => {
        const findings = r?.findings ?? [];
        if (!findings.length) return `Scanned ${r?.scanned ?? 0} scripts — no suspicious patterns found. ✅`;
        const lines = findings.map(
          (f: any) => `[${f.severity.toUpperCase()}] ${f.path}:${f.line} — ${f.label}\n    ${f.snippet}`,
        );
        return `Scanned ${r.scanned} scripts — ${findings.length} finding(s):\n\n${lines.join("\n")}`;
      }, place),
  );
}
