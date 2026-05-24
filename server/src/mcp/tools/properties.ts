import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio } from "../helpers.js";

export function registerPropertyTools(server: McpServer) {
  server.registerTool(
    "get_properties",
    {
      description: "Get all (or a chosen subset of) properties of the instance at path.",
      inputSchema: { path: z.string(), names: z.array(z.string()).optional() },
    },
    async ({ path, names }) => runStudio("getProperties", { path, names: names ?? null }),
  );

  server.registerTool(
    "set_property",
    {
      description: "Set a single property on the instance at path. Value can be a primitive or a typed wrapper like {Vector3:[x,y,z]}, {Color3:[r,g,b]}, {UDim2:[xs,xo,ys,yo]}, {EnumItem:'Enum.Material.Wood'}.",
      inputSchema: { path: z.string(), name: z.string(), value: z.any() },
    },
    async ({ path, name, value }) => runStudio("setProperty", { path, name, value }, () => `Set ${path}.${name}`),
  );

  server.registerTool(
    "mass_set_property",
    {
      description: "Set the same property to the same value on every instance in paths[].",
      inputSchema: { paths: z.array(z.string()), name: z.string(), value: z.any() },
    },
    async ({ paths, name, value }) =>
      runStudio("massSetProperty", { paths, name, value }, (r) => `Set ${name} on ${r.count} instance(s)`),
  );

  server.registerTool(
    "search_by_property",
    {
      description: "Find instances under rootPath whose property equals value.",
      inputSchema: { rootPath: z.string().optional(), name: z.string(), value: z.any() },
    },
    async ({ rootPath, name, value }) =>
      runStudio("searchByProperty", { rootPath: rootPath ?? "game", name, value }, (r) =>
        Array.isArray(r?.paths) && r.paths.length ? r.paths.join("\n") : "(no matches)",
      ),
  );
}
