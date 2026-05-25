import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText } from "../helpers.js";

// Server-side HTTP fetch (the Node server has unrestricted fetch; a Studio plugin
// can't reach arbitrary domains). Lets the AI pull docs / API data / references
// mid-task without leaving the tool.
export function registerHttpTools(server: McpServer) {
  server.registerTool(
    "http_get",
    {
      description:
        "Fetch a URL (GET) and return the response body as text. For grabbing docs, JSON APIs, or reference data while working. Body is capped at ~100 KB; 15s timeout.",
      inputSchema: {
        url: z.string().describe("absolute http(s) URL"),
        headers: z.record(z.string()).optional().describe("optional request headers"),
      },
    },
    async ({ url, headers }) => {
      if (!/^https?:\/\//i.test(url)) return errorText("url must start with http:// or https://");
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000), redirect: "follow" });
        const ct = res.headers.get("content-type") ?? "";
        const raw = await res.text();
        const CAP = 100_000;
        const body = raw.length > CAP ? raw.slice(0, CAP) + `\n…(truncated, ${raw.length} bytes total)` : raw;
        return text(`HTTP ${res.status} ${res.statusText}  [${ct}]\n\n${body}`);
      } catch (e) {
        return errorText(`http_get failed: ${(e as Error).message}`);
      }
    },
  );
}
