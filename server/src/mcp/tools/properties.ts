import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg } from "../helpers.js";

// Tagged-value keys the plugin's Serialize.decodeValue understands.
const TAG_KEYS = new Set([
  "Vector3", "Vector2", "Vector3int16", "Color3", "UDim", "UDim2", "CFrame", "Rect",
  "NumberRange", "NumberSequence", "ColorSequence", "Font", "PhysicalProperties",
  "EnumItem", "BrickColor", "Region3", "Faces", "Axes",
]);

// Some MCP clients stringify a tagged-value object (e.g. '{"Vector3":[1,2,3]}')
// instead of sending it as JSON — the plugin then gets a string and the set fails.
// Parse it back ONLY when it's an object carrying a recognized tag key; a plain
// string (or JSON without a tag key) passes through untouched so a literal string
// property can't be corrupted.
function maybeUnwrap(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (!s.startsWith("{")) return value;
  try {
    const o = JSON.parse(s);
    if (o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).some((k) => TAG_KEYS.has(k))) return o;
  } catch {
    /* not JSON — leave it as a literal string */
  }
  return value;
}

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
    async ({ path, name, value, place }) => runStudio("setProperty", { path, name, value: maybeUnwrap(value) }, () => `Set ${path}.${name}`, place),
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
      runStudio("massEdit", { edits: edits.map((e) => ({ ...e, value: maybeUnwrap(e.value) })) }, (r) => {
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
      runStudio("searchByProperty", { rootPath: rootPath ?? "game", name, value: maybeUnwrap(value) }, (r) =>
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
    async ({ path, name, value, place }) => runStudio("setAttribute", { path, name, value: maybeUnwrap(value) }, () => `Set attribute ${name}`, place),
  );

  server.registerTool(
    "mass_set_attribute",
    {
      description:
        "Set MANY attributes across instances in ONE call + one undo entry: edits = [{path, name, value}, ...]. " +
        "The attribute counterpart of mass_edit. Value may be a primitive or a typed wrapper like {Vector3:[x,y,z]}.",
      inputSchema: {
        edits: z.array(z.object({ path: z.string(), name: z.string(), value: z.any() })),
        place: placeArg,
      },
    },
    async ({ edits, place }) =>
      runStudio("massSetAttribute", { edits: edits.map((e) => ({ ...e, value: maybeUnwrap(e.value) })) }, (r) => {
        let out = `Set ${r.applied} attribute(s)${r.failed ? `, ${r.failed} failed` : ""}`;
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
}
