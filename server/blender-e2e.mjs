// Live headless-Blender E2E for blender_run + blender_process. Needs Blender
// installed (auto-detected); needs NO API keys and NO Studio.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const work = mkdtempSync(join(tmpdir(), "tufan-blender-e2e-"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env },
  stderr: "ignore",
});
const client = new Client({ name: "blender-e2e", version: "0.0.1" });
await client.connect(transport);

let ok = true;
const results = [];

async function call(tool, args) {
  const r = await client.callTool({ name: tool, arguments: args });
  return { text: r.content?.[0]?.text ?? "", isError: Boolean(r.isError) };
}

/** Parse the leading JSON object from tool output (tolerates trailing lines). */
function parseJson(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Find the matching close brace by depth.
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function check(label, pass, detail = "") {
  results.push(`${pass ? "PASS" : "FAIL"}  ${label}${pass || !detail ? "" : `\n  ${detail}`}`);
  ok = ok && pass;
}

// 1. blender_run: cube + sentinel round-trip (exercises detect → runner → parse)
{
  const r = await call("blender_run", {
    script: ["reset_scene()", "bpy.ops.mesh.primitive_cube_add()", "emit(inspect_report())"].join("\n"),
  });
  const j = parseJson(r.text);
  check("blender_run cube sentinel round-trip", !r.isError && j?.totals?.tris === 12, r.text.slice(0, 300));
}

// 2. blender_run: Python error → clean traceback (not a hang/native-crash report)
{
  const r = await call("blender_run", { script: "raise RuntimeError('intentional-test-error')" });
  check(
    "blender_run error → traceback surfaced",
    r.isError && r.text.includes("intentional-test-error") && r.text.includes("Traceback"),
    r.text.slice(0, 300),
  );
}

// 3. Author a dense ico-sphere GLB (81920 tris = 20 * 4^7) as pipeline input
const sphereGlb = join(work, "sphere.glb");
{
  const r = await call("blender_run", {
    script: [
      "reset_scene()",
      "bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=7)",
      "export_any(OUT)",
      "emit({'tris': tri_count(mesh_objs()[0])})",
    ].join("\n"),
    outputFile: sphereGlb,
  });
  const j = parseJson(r.text);
  check("author 81920-tri sphere GLB", !r.isError && j?.tris === 81920, r.text.slice(0, 300));
}

// 4. inspect flags the 20k violation
{
  const r = await call("blender_process", { inputFile: sphereGlb, action: "inspect" });
  const j = parseJson(r.text);
  check(
    "inspect flags >20k tris",
    !r.isError && j?.roblox_ready === false && j?.objects?.[0]?.over_tri_limit === true,
    r.text.slice(0, 300),
  );
}

// 5. decimate → under 20k, output GLB written
{
  const r = await call("blender_process", { inputFile: sphereGlb, action: "decimate", target: 19000 });
  const j = parseJson(r.text);
  const after = j?.decimated?.[0]?.after;
  check(
    "decimate 81920 → ≤20000 tris",
    !r.isError && typeof after === "number" && after > 0 && after <= 20000 && j?.roblox_ready === true,
    r.text.slice(0, 400),
  );
}

// 6. split_chunks → every piece ≤ target
{
  const r = await call("blender_process", { inputFile: sphereGlb, action: "split_chunks", target: 15000 });
  const j = parseJson(r.text);
  const objs = j?.objects ?? [];
  check(
    "split_chunks all pieces ≤ target",
    !r.isError && objs.length >= 4 && objs.every((o) => o.tris <= 15000),
    `pieces=${objs.map((o) => o.tris).join(",")} ${r.text.slice(0, 200)}`,
  );
}

// 7. split_by_material: 2-material cube → 2 objects
const matCube = join(work, "matcube.glb");
{
  const a = await call("blender_run", {
    script: [
      "reset_scene()",
      "bpy.ops.mesh.primitive_cube_add()",
      "o = mesh_objs()[0]",
      "m1 = bpy.data.materials.new('MatA'); m2 = bpy.data.materials.new('MatB')",
      "o.data.materials.append(m1); o.data.materials.append(m2)",
      "for i, p in enumerate(o.data.polygons):",
      "    p.material_index = 0 if i < 3 else 1",
      "export_any(OUT)",
      "emit({'mats': len(o.material_slots)})",
    ].join("\n"),
    outputFile: matCube,
  });
  const r = await call("blender_process", { inputFile: matCube, action: "split_by_material" });
  const j = parseJson(r.text);
  check(
    "split_by_material 2-mat cube → 2 objects",
    !a.isError && !r.isError && j?.totals?.objects === 2,
    r.text.slice(0, 300),
  );
}

// 8. downscale_textures: 2048px texture → ≤1024
const texCube = join(work, "texcube.glb");
{
  const a = await call("blender_run", {
    script: [
      "reset_scene()",
      "bpy.ops.mesh.primitive_cube_add()",
      "o = mesh_objs()[0]",
      "img = bpy.data.images.new('BigTex', width=2048, height=2048)",
      "img.pack()",
      "m = bpy.data.materials.new('TexMat')",
      "m.use_nodes = True",
      "tex = m.node_tree.nodes.new('ShaderNodeTexImage')",
      "tex.image = img",
      "bsdf = m.node_tree.nodes.get('Principled BSDF')",
      "m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])",
      "o.data.materials.append(m)",
      "export_any(OUT)",
      "emit({'ok': True})",
    ].join("\n"),
    outputFile: texCube,
  });
  const r = await call("blender_process", { inputFile: texCube, action: "downscale_textures" });
  const j = parseJson(r.text);
  check(
    "downscale_textures 2048 → ≤1024",
    !a.isError && !r.isError && (j?.scaled?.length ?? 0) >= 1 && (j?.oversize_textures?.length ?? 1) === 0,
    `${a.text.slice(0, 150)} | ${r.text.slice(0, 300)}`,
  );
}

// 9. set_origins runs clean
{
  const r = await call("blender_process", { inputFile: matCube, action: "set_origins" });
  const j = parseJson(r.text);
  check("set_origins runs", !r.isError && (j?.origins_set?.length ?? 0) >= 1, r.text.slice(0, 300));
}

// 10. convert sphere.glb → fbx
{
  const r = await call("blender_process", { inputFile: matCube, action: "convert", outputFile: join(work, "out.fbx") });
  check("convert glb → fbx", !r.isError && r.text.includes("out.fbx"), r.text.slice(0, 300));
}

// 11. fracture: Cell Fracture extension is installed (v0.12) — require REAL shards.
{
  const r = await call("blender_process", { inputFile: matCube, action: "fracture", shards: 5 });
  const j = parseJson(r.text);
  check("fracture produces real shards", !r.isError && (j?.pieces?.length ?? 0) >= 2, r.text.slice(0, 300));
}

// 12. v0.12 lint: flat-color cube reports base_color (sRGB) + has_texture=false
const flatCube = join(work, "flatcube.glb");
{
  const a = await call("blender_run", {
    script: [
      "reset_scene()",
      "bpy.ops.mesh.primitive_cube_add()",
      "o = mesh_objs()[0]",
      "m = bpy.data.materials.new('RedMat')",
      "m.use_nodes = True",
      "m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.5, 0.0, 0.0, 1.0)",
      "o.data.materials.append(m)",
      "export_any(OUT)",
      "emit({'ok': True})",
    ].join("\n"),
    outputFile: flatCube,
  });
  const r = await call("blender_process", { inputFile: flatCube, action: "inspect" });
  const j = parseJson(r.text);
  const obj = j?.objects?.[0];
  // linear 0.5 → sRGB ≈ 0.7354
  const colorOk = Array.isArray(obj?.base_color) && Math.abs(obj.base_color[0] - 0.7354) < 0.02 && obj.base_color[1] < 0.01;
  check(
    "inspect reports base_color (sRGB) + has_texture=false",
    !a.isError && !r.isError && colorOk && obj?.has_texture === false,
    `base_color=${JSON.stringify(obj?.base_color)} has_texture=${obj?.has_texture} ${r.text.slice(0, 150)}`,
  );
}

// 13. v0.12 thumbnail: renders a PNG and returns it as an image content block
{
  const raw = await client.callTool({ name: "blender_process", arguments: { inputFile: matCube, action: "thumbnail" } });
  const img = (raw.content ?? []).find((c) => c.type === "image");
  const txt = (raw.content ?? []).find((c) => c.type === "text")?.text ?? "";
  check(
    "thumbnail returns image block",
    !raw.isError && img && img.mimeType === "image/png" && (img.data?.length ?? 0) > 4000,
    `text=${txt.slice(0, 150)} imgBytes=${img?.data?.length ?? 0}`,
  );
}

await client.close();
console.log(results.join("\n"));
console.log(ok ? "\nALL PASS" : "\nFAILURES PRESENT");
process.exit(ok ? 0 : 1);
