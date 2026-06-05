// Canned bpy script templates for blender_process — Blender 4.x/5.x-correct
// Python (temp-override-free where possible: modifier baking goes through the
// depsgraph instead of bpy.ops, selection ops set the view-layer active object,
// which works headless). Every script ends by emit()ing a JSON dict through the
// @@TUFAN_RESULT@@ sentinel that runner.ts parses.
//
// Args reach Python as k=v tokens after `--` (parsed into ARGS by the preamble):
//   in=<input file> out=<output file> target=<tris> shards=<n> tex_limit=<px>

export const PREAMBLE = `
import bpy, json, sys, os, math
import addon_utils
from mathutils import Vector

RESULT = "@@TUFAN_RESULT@@"

_argv = sys.argv
ARGS = {}
if "--" in _argv:
    for _a in _argv[_argv.index("--") + 1:]:
        if "=" in _a:
            _k, _v = _a.split("=", 1)
            ARGS[_k] = _v

IN = ARGS.get("in")
OUT = ARGS.get("out")

def emit(obj):
    print(RESULT + json.dumps(obj))

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)  # 4.0+ name (import_scene.obj was removed)
    elif ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        raise RuntimeError("unsupported input extension: " + ext)

def load_input():
    if not IN:
        raise RuntimeError("missing in= argument")
    if not os.path.isfile(IN):
        raise RuntimeError("input file not found: " + IN)
    if os.path.splitext(IN)[1].lower() != ".blend":
        reset_scene()
    import_any(IN)

def export_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".glb":
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True)
    elif ext == ".fbx":
        bpy.ops.export_scene.fbx(filepath=path)
    else:
        raise RuntimeError("unsupported output extension (use .glb or .fbx): " + ext)

def mesh_objs():
    return [o for o in bpy.data.objects if o.type == "MESH"]

def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)

def select_only(objs, active=None):
    for ob in list(bpy.context.selected_objects):
        ob.select_set(False)
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)

def apply_all_modifiers(o):
    # Headless-safe modifier bake: evaluate through the depsgraph and swap the
    # mesh datablock — no bpy.ops context requirements at all. (Does NOT realize
    # GN-instanced geometry — only the object's own evaluated mesh.)
    if not o.modifiers:
        return
    deps = bpy.context.evaluated_depsgraph_get()
    eval_obj = o.evaluated_get(deps)
    new_mesh = bpy.data.meshes.new_from_object(eval_obj, preserve_all_data_layers=True, depsgraph=deps)
    old = o.data
    o.data = new_mesh
    o.modifiers.clear()
    if old.users == 0:
        bpy.data.meshes.remove(old)

def real_images():
    return [im for im in bpy.data.images
            if im.type == "IMAGE" and im.size[0] > 0 and im.name not in ("Render Result", "Viewer Node")]

def to_srgb(c):
    # Blender stores Base Color linear; Roblox Color3 components are sRGB.
    out = []
    for l in c[:3]:
        if l <= 0.0031308:
            out.append(round(12.92 * l, 4))
        else:
            out.append(round(1.055 * (l ** (1.0 / 2.4)) - 0.055, 4))
    return out

def mat_info(o):
    # First material's Base Color (sRGB 0-1) + whether it's texture-driven.
    # Roblox DROPS flat baseColorFactor on import (known bug) — the server's
    # post-insert finisher recovers it onto MeshPart.Color using this report.
    for s in o.material_slots:
        m = s.material
        if not m:
            continue
        col, has_tex = None, False
        if m.use_nodes and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    inp = n.inputs.get("Base Color")
                    if inp:
                        has_tex = len(inp.links) > 0
                        col = to_srgb(list(inp.default_value))
                    break
        if col is None:
            col = to_srgb(list(m.diffuse_color))
        return col, has_tex
    return None, False

def inspect_report():
    objs = mesh_objs()
    report = {"objects": [], "warnings": []}
    total = 0
    for o in objs:
        tris = tri_count(o)
        total += tris
        mats = [s.material.name for s in o.material_slots if s.material]
        base_color, has_texture = mat_info(o)
        rec = {
            "name": o.name,
            "tris": tris,
            "materials": mats,
            "base_color": base_color,
            "has_texture": has_texture,
            "uv_sets": len(o.data.uv_layers),
            "dimensions": [round(d, 3) for d in o.dimensions],
            "over_tri_limit": tris > 20000,
            "multi_material": len(mats) > 1,
        }
        report["objects"].append(rec)
        if tris > 20000:
            report["warnings"].append("%s: %d tris > 20k Roblox limit (uploads get SILENTLY decimated)" % (o.name, tris))
        if len(mats) > 1:
            report["warnings"].append("%s: %d materials - Roblox supports ONE material per mesh object (use split_by_material)" % (o.name, len(mats)))
        if len(o.data.uv_layers) > 1:
            report["warnings"].append("%s: %d UV sets - Roblox uses a single 0-1 UV set" % (o.name, len(o.data.uv_layers)))
    oversize = []
    for im in real_images():
        if max(im.size) > 1024:
            oversize.append({"name": im.name, "size": [im.size[0], im.size[1]]})
            report["warnings"].append("texture %s: %dx%d > 1024 SurfaceAppearance cap (use downscale_textures)" % (im.name, im.size[0], im.size[1]))
    report["oversize_textures"] = oversize
    report["totals"] = {"objects": len(objs), "tris": total}
    report["roblox_ready"] = len(report["warnings"]) == 0
    return report
`;

const OP_BODIES: Record<string, string> = {
  inspect: `
def run_op():
    load_input()
    return inspect_report()
`,

  decimate: `
def run_op():
    target = int(float(ARGS.get("target", "20000")))
    load_input()
    changed = []
    for o in mesh_objs():
        tris = tri_count(o)
        if tris <= target:
            continue
        mod = o.modifiers.new("TufanDecimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.005, float(target) / float(tris))
        apply_all_modifiers(o)
        changed.append({"name": o.name, "before": tris, "after": tri_count(o)})
    if OUT:
        export_any(OUT)
    rep = inspect_report()
    rep["decimated"] = changed
    return rep
`,

  split_by_material: `
def run_op():
    load_input()
    split = []
    for o in list(mesh_objs()):
        if len([s for s in o.material_slots if s.material]) <= 1:
            continue
        select_only([o], o)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="MATERIAL")
        bpy.ops.object.mode_set(mode="OBJECT")
        split.append(o.name)
    if OUT:
        export_any(OUT)
    rep = inspect_report()
    rep["split"] = split
    return rep
`,

  split_chunks: `
def run_op():
    import bmesh
    target = int(float(ARGS.get("target", "20000")))
    load_input()

    # Recursive binary bisection: split at the spatial midpoint of the longest
    # axis and recurse on any half still over target — self-correcting for
    # uneven tri distribution (equal-width bands are NOT equal-tri bands).
    def bisect_copy(src, axis, value, keep_lower):
        dup = src.copy()
        dup.data = src.data.copy()
        coll = src.users_collection[0] if src.users_collection else bpy.context.scene.collection
        coll.objects.link(dup)
        bm = bmesh.new()
        bm.from_mesh(dup.data)
        no = Vector((0.0, 0.0, 0.0)); no[axis] = 1.0
        co = Vector((0.0, 0.0, 0.0)); co[axis] = value
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no,
                                     clear_outer=keep_lower, clear_inner=(not keep_lower))
        try:
            edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
            if edges:
                bmesh.ops.edgenet_fill(bm, edges=edges)
        except Exception:
            pass
        bm.to_mesh(dup.data)
        bm.free()
        return dup

    def data_bbox(o):
        # Object.bound_box is STALE on never-evaluated copies (it only refreshes
        # on depsgraph eval) — scan the mesh vertices instead.
        vs = o.data.vertices
        mn = Vector((min(v.co[i] for v in vs) for i in range(3)))
        mx = Vector((max(v.co[i] for v in vs) for i in range(3)))
        return mn, mx

    made = []
    work = []
    for o in list(mesh_objs()):
        if tri_count(o) > target:
            work.append((o, 0))
        else:
            made.append(o.name)
    while work:
        o, depth = work.pop()
        if tri_count(o) <= target or depth >= 8 or len(o.data.vertices) == 0:
            made.append(o.name)
            continue
        mn, mx = data_bbox(o)
        size = mx - mn
        axis = max(range(3), key=lambda i: size[i])
        mid = (mn[axis] + mx[axis]) / 2.0
        halves = [bisect_copy(o, axis, mid, True), bisect_copy(o, axis, mid, False)]
        suffix = ["_a", "_b"]
        base = o.name
        bpy.data.objects.remove(o, do_unlink=True)
        for h, s in zip(halves, suffix):
            if tri_count(h) == 0:
                bpy.data.objects.remove(h, do_unlink=True)
                continue
            h.name = base + s
            work.append((h, depth + 1))
    if OUT:
        export_any(OUT)
    rep = inspect_report()
    rep["chunks"] = made
    return rep
`,

  fracture: `
def run_op():
    shards = int(float(ARGS.get("shards", "10")))
    # IMPORTANT: load_input() FIRST — reset_scene()'s read_factory_settings
    # resets enabled add-ons, which would wipe a just-enabled Cell Fracture.
    load_input()
    # The extension module is bl_ext.<repo>.cell_fracture (4.2+); the legacy
    # bundled add-on (<=4.1) was object_fracture_cell. Try both.
    for _mod in ("bl_ext.blender_org.cell_fracture", "object_fracture_cell"):
        try:
            addon_utils.enable(_mod, default_set=False)
        except Exception:
            pass
        if hasattr(bpy.ops.object, "add_fracture_cell_objects"):
            break
    if not hasattr(bpy.ops.object, "add_fracture_cell_objects"):
        return {"error": "Cell Fracture extension not available. Install it headlessly with: "
                "blender --command extension sync && blender --command extension install cell_fracture --enable "
                "(or from extensions.blender.org/add-ons/cell-fracture), then retry."}
    before = set(o.name for o in bpy.data.objects)
    originals = list(mesh_objs())
    for o in originals:
        select_only([o], o)
        bpy.ops.object.add_fracture_cell_objects(source_limit=shards, use_recenter=True)
    # Cell Fracture ADDS cells next to the source — remove the originals so the
    # export contains shards only (the destructible pieces).
    for o in originals:
        bpy.data.objects.remove(o, do_unlink=True)
    pieces = [o.name for o in mesh_objs() if o.name not in before]
    if OUT:
        export_any(OUT)
    rep = inspect_report()
    rep["pieces"] = pieces
    return rep
`,

  set_origins: `
def run_op():
    load_input()
    objs = mesh_objs()
    if objs:
        select_only(objs, objs[0])
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="MEDIAN")
    if OUT:
        export_any(OUT)
    return {"origins_set": [o.name for o in objs]}
`,

  convert: `
def run_op():
    if not OUT:
        raise RuntimeError("convert needs an output file (out=<path .glb/.fbx>)")
    load_input()
    for o in mesh_objs():
        apply_all_modifiers(o)
    export_any(OUT)
    return {"converted": OUT, "inspect": inspect_report()}
`,

  thumbnail: `
def run_op():
    import mathutils
    size = int(float(ARGS.get("size", "512")))
    load_input()
    sc = bpy.context.scene

    # frame the union of all mesh world-space bounding corners
    mn = mathutils.Vector((1e9, 1e9, 1e9))
    mx = mathutils.Vector((-1e9, -1e9, -1e9))
    for o in mesh_objs():
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector((min(mn[i], w[i]) for i in range(3)))
            mx = mathutils.Vector((max(mx[i], w[i]) for i in range(3)))
    if mn.x > mx.x:
        return {"error": "no mesh objects to render"}
    center = (mn + mx) * 0.5
    radius = max((mx - mn).length * 0.5, 0.001)

    # 3/4 hero-angle camera framed by the bounding radius
    cam_data = bpy.data.cameras.new("TufanCam")
    cam = bpy.data.objects.new("TufanCam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_data.lens = 50
    direction = mathutils.Vector((1.0, -1.0, 0.65)).normalized()
    dist = radius / math.tan(cam_data.angle * 0.5) * 1.3
    cam.location = center + direction * dist
    look = (center - cam.location).normalized()
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()

    # key + fill suns and a neutral ambient world (no HDRI dependency)
    key = bpy.data.objects.new("TufanKey", bpy.data.lights.new("TufanKey", "SUN"))
    key.data.energy = 4.0
    key.rotation_euler = mathutils.Euler((math.radians(50), 0.0, math.radians(35)))
    sc.collection.objects.link(key)
    fill = bpy.data.objects.new("TufanFill", bpy.data.lights.new("TufanFill", "SUN"))
    fill.data.energy = 1.5
    fill.rotation_euler = mathutils.Euler((math.radians(60), 0.0, math.radians(-120)))
    sc.collection.objects.link(fill)
    if sc.world is None:
        sc.world = bpy.data.worlds.new("TufanWorld")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.9, 0.9, 0.9, 1.0)
        bg.inputs[1].default_value = 0.6

    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    out = OUT or os.path.join(os.path.dirname(IN), "thumbnail.png")
    sc.render.filepath = out

    # EEVEE(-Next) is fast but needs a GPU/display context (fails on true-headless
    # boxes); Cycles CPU always works. Try fast first, fall back to reliable.
    avail = set(e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items)
    engines = [e for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE") if e in avail] + ["CYCLES"]
    used, last_err = None, None
    for eng in engines:
        try:
            sc.render.engine = eng
            if eng.startswith("BLENDER_EEVEE"):
                sc.eevee.taa_render_samples = 16
            else:
                sc.cycles.samples = 32
                sc.cycles.use_denoising = True
                sc.cycles.device = "CPU"
            bpy.ops.render.render(write_still=True)
            used = eng
            break
        except Exception as e:
            last_err = str(e)
    if not used:
        raise RuntimeError("render failed on every engine: " + str(last_err))
    return {"thumbnail": out, "engine": used, "size": size}
`,

  downscale_textures: `
def run_op():
    limit = int(float(ARGS.get("tex_limit", "1024")))
    load_input()
    scaled = []
    for im in real_images():
        w, h = im.size
        if max(w, h) <= limit:
            continue
        f = limit / float(max(w, h))
        nw, nh = max(1, int(w * f)), max(1, int(h * f))
        im.scale(nw, nh)
        try:
            im.pack()
        except Exception:
            pass
        scaled.append({"name": im.name, "from": [w, h], "to": [nw, nh]})
    if OUT:
        export_any(OUT)
    rep = inspect_report()
    rep["scaled"] = scaled
    return rep
`,
};

export const CANNED_OPS = Object.keys(OP_BODIES) as Array<keyof typeof OP_BODIES & string>;

const FOOTER = `
emit(run_op())
`;

/** Full script for a canned op: preamble + op body + emit footer. */
export function buildOpScript(op: string): string {
  const body = OP_BODIES[op];
  if (!body) throw new Error(`unknown blender_process action: ${op}`);
  return PREAMBLE + body + FOOTER;
}

/** Wrap an arbitrary user bpy script with the shared preamble (ARGS/IN/OUT/emit). */
export function buildUserScript(userScript: string): string {
  return PREAMBLE + "\n" + userScript + "\n";
}
