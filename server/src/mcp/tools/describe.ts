import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudioCached, placeArg } from "../helpers.js";

export function registerDescribeTools(server: McpServer) {
  server.registerTool(
    "describe",
    {
      description:
        "Full context of one instance in a SINGLE call: identity, key properties, attributes, " +
        "tags, a class-bucketed child summary, attached scripts (with line counts), and world " +
        "bounds. Replaces the 5-6 round-trips (get_properties + get_children + get_attributes + " +
        "get_tags + script grep) it used to take to understand a node. Cached.",
      inputSchema: { path: z.string(), place: placeArg },
    },
    async ({ path, place }) =>
      runStudioCached(
        "describe",
        { path },
        (r) => {
          const lines: string[] = [];
          lines.push(`${r.className}  ${r.path}`);
          if (r.size) lines.push(`size [${r.size.map((n: number) => n.toFixed(1)).join(", ")}]  pos [${(r.position ?? []).map((n: number) => n.toFixed(1)).join(", ")}]`);
          if (r.tags?.length) lines.push(`tags: ${r.tags.join(", ")}`);

          const props = Object.entries(r.properties ?? {});
          if (props.length) lines.push("\nproperties:\n" + props.map(([k, v]) => `  ${k} = ${fmt(v)}`).join("\n"));

          const attrs = Object.entries(r.attributes ?? {});
          if (attrs.length) lines.push("\nattributes:\n" + attrs.map(([k, v]) => `  ${k} = ${fmt(v)}`).join("\n"));

          const kids = Object.entries(r.children ?? {});
          if (kids.length) lines.push(`\nchildren (${r.childCount}): ` + kids.map(([c, n]) => `${c} ×${n}`).join(", "));

          if (r.scripts?.length) lines.push("\nscripts:\n" + r.scripts.map((s: any) => `  ${s.className}  ${s.path} (${s.lines} lines)`).join("\n"));

          return lines.join("\n");
        },
        place,
      ),
  );
}

function fmt(v: any): string {
  if (v && typeof v === "object") {
    const k = Object.keys(v)[0];
    return `${k}(${JSON.stringify((v as any)[k])})`;
  }
  return String(v);
}
