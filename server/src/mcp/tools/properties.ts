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

  server.registerTool(
    "mass_set_property",
    {
      description: "Set the same property/value on every instance in paths[].",
      inputSchema: { paths: z.array(z.string()), name: z.string(), value: z.any(), place: placeArg },
    },
    async ({ paths, name, value, place }) =>
      runStudio("massSetProperty", { paths, name, value }, (r) => `Set ${name} on ${r.count} instance(s)`, place),
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
}
