import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runStudio, placeArg, pathArg, optionalPathArg, VALUE_FORMAT } from "../helpers.js";

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
      description:
        "Read property values of one instance as JSON. Read-only. " +
        "Without names it returns Name, ClassName, all attributes and a common set (Position, Size, CFrame, Color, Material, Transparency, Anchored, Text, Visible, Enabled, Value, Source and more) that applies to the class; Roblox has no API to list every property, so pass names for anything else. " +
        "For identity, children, tags and attributes in one call use describe; for attributes only use get_attributes.",
      inputSchema: {
        path: pathArg("Instance to read"),
        names: z.array(z.string()).optional().describe('Exact property names to read, e.g. ["Size", "ZIndex"]. Names that do not exist on the class are left out of the result.'),
        place: placeArg,
      },
    },
    async ({ path, names, place }) => runStudio("getProperties", { path, names: names ?? null }, undefined, place),
  );

  server.registerTool(
    "set_property",
    {
      description:
        "Set one property on one instance in the edit copy, recorded as one Studio undo step. Fails with the Roblox error if the property is read-only or the value has the wrong type. " +
        "For more than one change use mass_edit (one call, one undo step); for attributes use set_attribute.",
      inputSchema: {
        path: pathArg("Instance to change"),
        name: z.string().describe('Property name, e.g. "Transparency" or "BackgroundColor3".'),
        value: z.any().describe(`New value. ${VALUE_FORMAT}`),
        place: placeArg,
      },
    },
    async ({ path, name, value, place }) => runStudio("setProperty", { path, name, value: maybeUnwrap(value) }, () => `Set ${path}.${name}`, place),
  );

  // mass_set_property killed → mass_edit is a strict superset (repeat the path in
  // the edits list with the same name/value).

  server.registerTool(
    "mass_edit",
    {
      description:
        "Apply many property changes, across any number of instances, in one call recorded as one Studio undo step. " +
        "Each edit is tried on its own: failures (unresolved path, bad property or value) are listed with their index and reason, and the rest still apply. " +
        "Prefer it over repeated set_property calls, since Roblox limits the plugin to about 500 requests a minute. For attributes use mass_set_attribute.",
      inputSchema: {
        edits: z.array(
          z.object({
            path: pathArg("Instance to change"),
            name: z.string().describe("Property name"),
            value: z.any().describe(`New value. ${VALUE_FORMAT}`),
          }),
        ).describe("One entry per change. The same path may appear several times."),
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
      description:
        "Find every instance under a root whose property equals a given value, and list their paths. Read-only. " +
        "Use it for questions like \"which parts are still Anchored=false\" or \"which labels use Font Arial\". " +
        "To find by name or class use search_objects; to search the Roblox marketplace use search_assets.",
      inputSchema: {
        rootPath: optionalPathArg("Where to start searching", "the whole DataModel (game)"),
        name: z.string().describe('Property to compare, e.g. "Anchored" or "Material".'),
        value: z.any().describe(`Value to match exactly. ${VALUE_FORMAT}`),
        place: placeArg,
      },
    },
    async ({ rootPath, name, value, place }) =>
      runStudio("searchByProperty", { rootPath: rootPath ?? "game", name, value: maybeUnwrap(value) }, (r) =>
        Array.isArray(r?.paths) && r.paths.length ? r.paths.join("\n") : "(no matches)",
        place,
      ),
  );

  server.registerTool(
    "get_attributes",
    {
      description:
        "Read every attribute set on one instance as a JSON object of name to value. Read-only; returns {} when there are none. " +
        "For attributes together with properties, tags and children use describe.",
      inputSchema: { path: pathArg("Instance to read"), place: placeArg },
    },
    async ({ path, place }) => runStudio("getAttributes", { path }, (r) => JSON.stringify(r?.attributes ?? {}, null, 2), place),
  );

  server.registerTool(
    "set_attribute",
    {
      description:
        "Create or overwrite one attribute on one instance, recorded as one Studio undo step. " +
        "For several attributes use mass_set_attribute; for built-in properties use set_property.",
      inputSchema: {
        path: pathArg("Instance to change"),
        name: z.string().describe("Attribute name. Letters, digits and underscores, up to 100 characters (a Roblox rule)."),
        value: z.any().describe(`Attribute value. ${VALUE_FORMAT}`),
        place: placeArg,
      },
    },
    async ({ path, name, value, place }) => runStudio("setAttribute", { path, name, value: maybeUnwrap(value) }, () => `Set attribute ${name}`, place),
  );

  server.registerTool(
    "mass_set_attribute",
    {
      description:
        "Set many attributes, across any number of instances, in one call recorded as one Studio undo step. " +
        "Each edit is tried on its own; failures are listed with their index and reason while the rest still apply. " +
        "The attribute version of mass_edit; for one attribute set_attribute is enough.",
      inputSchema: {
        edits: z.array(
          z.object({
            path: pathArg("Instance to change"),
            name: z.string().describe("Attribute name"),
            value: z.any().describe(`New value. ${VALUE_FORMAT}`),
          }),
        ).describe("One entry per change. The same path may appear several times."),
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
