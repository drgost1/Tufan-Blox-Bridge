import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerHealthTools(server: McpServer) {
  server.registerTool(
    "project_health",
    {
      description:
        "One-look census of the whole place: instance / script / part counts, total Luau size, " +
        "particle + light counts, a per-service descendant breakdown, tag count, and StreamingEnabled. " +
        "The fast 'what is this game?' overview before diving in. Read-only.",
      inputSchema: { place: placeArg },
    },
    async ({ place }) =>
      runStudio("projectHealth", {}, (r) => {
        const c = r?.counts ?? {};
        const kb = ((c.scriptBytes ?? 0) / 1024).toFixed(1);
        const lines = [
          `Place: "${r?.placeName ?? "?"}" (${r?.placeId ?? 0})`,
          `Instances: ${c.instances ?? 0}`,
          `Scripts:   ${c.scripts ?? 0}  (${kb} KB of Luau)`,
          `Parts:     ${c.parts ?? 0}  (${c.meshparts ?? 0} mesh, ${c.unions ?? 0} union)`,
          `Particles: ${c.particles ?? 0}   Lights: ${c.lights ?? 0}`,
          `Tags: ${r?.tagCount ?? 0}   StreamingEnabled: ${r?.streamingEnabled ? "on" : "off"}`,
        ];
        const bs: Record<string, number> = r?.byService ?? {};
        const svc = Object.entries(bs)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `  ${k}: ${v}`)
          .join("\n");
        if (svc) lines.push("By service (descendant count):\n" + svc);
        return lines.join("\n");
      }, place),
  );
}
