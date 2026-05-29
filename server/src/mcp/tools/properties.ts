import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

export function registerPropertyTools(server: McpServer) {
  server.registerTool(
    "get_properties",
    {
      description: "Get all (or chosen) properties of the instance at path.",
      inputSchema: { path: z.string(), names: z.array(z.string()).optional(), place: placeArg },
    },
    async ({ path, names, place }) => runStudio("getProperties", { path, names: names ?? null }, undefined, place),
  );

  server.registerTool(
    "set_property",
    {
      description: "Set one property. Value can be a primitive or {Vector3:[x,y,z]}, {Color3:[r,g,b]}, {UDim2:[xs,xo,ys,yo]}, {EnumItem:'Enum.Material.Wood'}.",
      inputSchema: { path: z.string(), name: z.string(), value: z.any(), place: placeArg },
    },
    async ({ path, name, value, place }) => runStudio("setProperty", { path, name, value }, () => `Set ${path}.${name}`, place),
  );

  // mass_set_property killed → mass_edit is a strict superset (repeat the path in
  // the edits list with the same name/value).

  server.registerTool(
    "mass_edit",
    {
      description:
        "Apply MANY different property edits in ONE call (and one undo entry): edits = [{path, name, value}, ...]. Use this instead of many set_property calls — far fewer round-trips (Roblox HttpService caps ~500 req/min, so bulk single-edits throttle).",
      inputSchema: {
        edits: z.array(z.object({ path: z.string(), name: z.string(), value: z.any() })),
        place: placeArg,
      },
    },
    async ({ edits, place }) =>
      runStudio("massEdit", { edits }, (r) => {
        let out = `Applied ${r.applied} edit(s)${r.failed ? `, ${r.failed} failed` : ""}`;
        // Surface WHY edits failed (path unresolved / bad property) so a partial
        // failure is debuggable instead of just a count.
        if (Array.isArray(r?.errors) && r.errors.length) {
          out +=
            "\nFailures:\n" +
            r.errors
              .slice(0, 20)
              .map((e: any) => `  [${e.index}] ${e.path ?? "?"}${e.name ? "." + e.name : ""} — ${e.reason}`)
              .join("\n");
          if (r.errors.length > 20) out += `\n  …and ${r.errors.length - 20} more`;
        }
        return out;
      }, place),
  );

  server.registerTool(
    "search_by_property",
    {
      description: "Find instances under rootPath whose property equals value.",
      inputSchema: { rootPath: z.string().optional(), name: z.string(), value: z.any(), place: placeArg },
    },
    async ({ rootPath, name, value, place }) =>
      runStudio("searchByProperty", { rootPath: rootPath ?? "game", name, value }, (r) =>
        Array.isArray(r?.paths) && r.paths.length ? r.paths.join("\n") : "(no matches)",
        place,
      ),
  );

  server.registerTool(
    "get_attributes",
    { description: "All attributes of the instance at path.", inputSchema: { path: z.string(), place: placeArg } },
    async ({ path, place }) => runStudio("getAttributes", { path }, (r) => JSON.stringify(r?.attributes ?? {}, null, 2), place),
  );

  server.registerTool(
    "set_attribute",
    {
      description: "Set an attribute on the instance at path (value may be primitive or a typed wrapper like {Vector3:[x,y,z]}).",
      inputSchema: { path: z.string(), name: z.string(), value: z.any(), place: placeArg },
    },
    async ({ path, name, value, place }) => runStudio("setAttribute", { path, name, value }, () => `Set attribute ${name}`, place),
  );
}
