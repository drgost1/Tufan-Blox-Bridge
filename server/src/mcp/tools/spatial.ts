import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text, errorText, placeArg } from "../helpers.js";
import { resolveTargetPlace, dispatchTo } from "../../bridge/sessions.js";
import { bumpPlace } from "../../bridge/cache.js";

// Spatial-awareness layer. Surfaces the engine's projection / raycast / bounds
// primitives so the AI can relate what it SEES (a screenshot) to world
// coordinates: ground a screenshot to coords (scene_state), find what's under a
// screen point (pick), query a region (objects_in_region), and compute+apply an
// accurate flush placement (place_on).
//
// Implementation note (load-bearing): these tools dispatch CANNED Luau through
// the existing runLuau bridge op (no plugin change, ships server-only like
// importing.ts). runLuau runs the chunk via loadstring, so it has NO `script`
// global — the canned code CANNOT require the plugin's Serialize module. It uses
// only primitive Roblox APIs + an inlined path resolver. The runLuau handler
// runs the returned table through Serialize.encodeDeep server-side, so any
// CFrame we return as userdata arrives as { CFrame: [12 floats] }; plain number
// arrays pass through untouched. Read tools dispatch FIXED read-only code, so
// they're safe to expose even though run_luau itself is write-gated — keep them
// OUT of WRITE_TOOLS. Units: studs (world/size/distance), degrees (orientation),
// pixels top-left (screen), CFrame = 12 floats (pos 1-3, rotation matrix 4-12).

// Serialize a JS value to a Luau literal for safe interpolation into canned code.
function lua(v: unknown): string {
  if (v === undefined || v === null) return "nil";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v); // valid Luau string for ASCII
  if (Array.isArray(v)) return "{" + v.map(lua).join(",") + "}";
  if (typeof v === "object") {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue;
      parts.push(`${k}=${lua(val)}`);
    }
    return "{" + parts.join(",") + "}";
  }
  return "nil";
}

// Shared helpers prepended to every canned script. No `script` global available.
const PRELUDE = `
local function resolve(path)
  if not path or path == "" then return nil end
  local parts = {}
  for seg in string.gmatch(path, "[^%.]+") do parts[#parts+1] = seg end
  local i = 1
  if parts[1] == "game" then i = 2 end
  local svc = parts[i]; if not svc then return nil end
  local cur
  local ok, s = pcall(function() return game:GetService(svc) end)
  cur = (ok and s) or game:FindFirstChild(svc)
  i = i + 1
  while cur and i <= #parts do cur = cur:FindFirstChild(parts[i]); i = i + 1 end
  return cur
end
local function round(n) return math.floor(n * 1000 + 0.5) / 1000 end
local function v3(v) return { round(v.X), round(v.Y), round(v.Z) } end
local function cf12(c) local t = { c:GetComponents() } for k = 1, #t do t[k] = round(t[k]) end return t end
local function degs(c) local rx, ry, rz = c:ToOrientation() return { round(math.deg(rx)), round(math.deg(ry)), round(math.deg(rz)) } end
`;

// Run a canned read-only script and return its resultJson (or {error}).
async function probe(place: string | number | undefined, body: string): Promise<{ data?: any; error?: string }> {
  const target = resolveTargetPlace(place);
  if (target.error) return { error: target.error };
  try {
    const r: any = await dispatchTo(target.placeId!, "runLuau", { code: PRELUDE + body });
    if (r?.resultJson !== undefined && r?.resultJson !== null) return { data: r.resultJson };
    // a script that returned a primitive/string (shouldn't happen for these) or nothing
    return { error: r?.result != null ? String(r.result) : "no result returned from Studio" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function registerSpatialTools(server: McpServer) {
  // ---- scene_state (read) ----------------------------------------------------
  server.registerTool(
    "scene_state",
    {
      description:
        "Spatial snapshot of the scene as the editor camera sees it: camera intrinsics (CFrame, FOV, viewport) + a curated list of visible objects, each with world position/orientation/size AND its on-screen pixel (x,y,depth,onScreen) via WorldToScreenPoint. This is what grounds a screenshot — it lets you say \"object X is at screen (px,py) = world (x,y,z)\". A Model counts as one object (bounding box); closest objects first. Pair with capture_screenshot. Read-only.",
      inputSchema: {
        rootPath: z.string().optional().describe("Scope the scan (default Workspace)"),
        maxObjects: z.number().int().min(1).max(120).optional().describe("default 40, capped 120 for transport"),
        onScreenOnly: z.boolean().optional().describe("default true — drop objects off-screen / behind camera"),
        nameFilter: z.string().optional().describe("substring match on Name"),
        classFilter: z.string().optional().describe("IsA class filter, e.g. Model, MeshPart"),
        maxDepth: z.number().int().min(1).max(6).optional().describe("walk depth (default 2); Models are taken whole"),
        place: placeArg,
      },
    },
    async ({ rootPath, maxObjects, onScreenOnly, nameFilter, classFilter, maxDepth, place }) => {
      const P = lua({
        rootPath,
        maxObjects: Math.min(maxObjects ?? 40, 120),
        onScreenOnly: onScreenOnly !== false,
        nameFilter,
        classFilter,
        maxDepth: maxDepth ?? 2,
      });
      const body = `
local P = ${P}
local cam = workspace.CurrentCamera
if not cam then return { error = "no CurrentCamera (open the place in Studio)" } end
local root = resolve(P.rootPath) or workspace
local visited, LIMIT, truncatedWalk = 0, 4000, false
local cand = {}
local function consider(inst, isModel)
  local okc, cf, sz = pcall(function()
    if isModel then local c, s = inst:GetBoundingBox() return c, s else return inst.CFrame, inst.Size end
  end)
  if not okc or not cf then return end
  cand[#cand + 1] = { inst = inst, cf = cf, size = sz, class = inst.ClassName }
end
local function walk(node, depth)
  if visited > LIMIT then truncatedWalk = true return end
  for _, ch in ipairs(node:GetChildren()) do
    visited = visited + 1
    if visited > LIMIT then truncatedWalk = true return end
    if ch:IsA("Terrain") or ch:IsA("Camera") then
      -- skip non-spatial singletons
    elseif ch:IsA("Model") then
      consider(ch, true)
    elseif ch:IsA("BasePart") then
      consider(ch, false)
    elseif ch:IsA("Folder") then
      if depth < P.maxDepth then walk(ch, depth + 1) end
    end
  end
end
walk(root, 1)
local objs = {}
for _, c in ipairs(cand) do
  pcall(function()
    if P.classFilter and not c.inst:IsA(P.classFilter) then return end
    if P.nameFilter and not string.find(string.lower(c.inst.Name), string.lower(P.nameFilter), 1, true) then return end
    local sp, on = cam:WorldToScreenPoint(c.cf.Position)
    if P.onScreenOnly and (not on or sp.Z <= 0) then return end
    objs[#objs + 1] = {
      path = c.inst:GetFullName(), class = c.class,
      world = v3(c.cf.Position), size = v3(c.size), orientation = degs(c.cf), cframe = cf12(c.cf),
      screen = { math.floor(sp.X), math.floor(sp.Y), round(sp.Z), on },
      _d = sp.Z,
    }
  end)
end
table.sort(objs, function(a, b) return a._d < b._d end)
local out = {}
for i = 1, math.min(#objs, P.maxObjects) do objs[i]._d = nil out[i] = objs[i] end
local cc = cam.CFrame
return {
  camera = { cframe = cf12(cc), position = v3(cc.Position), lookVector = v3(cc.LookVector), fov = round(cam.FieldOfView), viewport = { math.floor(cam.ViewportSize.X), math.floor(cam.ViewportSize.Y) } },
  objects = out, count = #out, truncatedWalk = truncatedWalk,
}
`;
      const { data, error } = await probe(place, body);
      if (error) return errorText(`scene_state failed: ${error}`);
      if (data?.error) return errorText(`scene_state: ${data.error}`);
      const cam = data?.camera ?? {};
      const header = `camera pos [${(cam.position ?? []).join(", ")}] look [${(cam.lookVector ?? []).join(", ")}] fov ${cam.fov} viewport ${(cam.viewport ?? []).join("x")}\n${data?.count ?? 0} object(s), closest first${data?.truncatedWalk ? " (walk truncated — scope rootPath)" : ""}:`;
      return text(`${header}\n${JSON.stringify(data?.objects ?? [], null, 2)}`);
    },
  );

  // ---- pick (read) -----------------------------------------------------------
  server.registerTool(
    "pick",
    {
      description:
        "Raycast from a screen point into the scene and report what's under it: the hit instance (+ nearest Model ancestor), world position, surface normal, distance, and the part's CFrame/size/orientation. Give x,y in pixels OR nx,ny in 0..1 OR nothing for the viewport center. Powers \"what is that?\" and tracing (sample points along a screen path). Read-only.",
      inputSchema: {
        x: z.number().optional().describe("screen X in pixels"),
        y: z.number().optional().describe("screen Y in pixels"),
        nx: z.number().optional().describe("normalized X 0..1 (used if x/y omitted)"),
        ny: z.number().optional().describe("normalized Y 0..1"),
        range: z.number().optional().describe("ray length in studs (default 5000)"),
        ignore: z.array(z.string()).optional().describe("instance paths to ignore (and their descendants)"),
        only: z.array(z.string()).optional().describe("whitelist: only hit these instances/descendants"),
        place: placeArg,
      },
    },
    async ({ x, y, nx, ny, range, ignore, only, place }) => {
      const P = lua({ x, y, nx, ny, range: range ?? 5000, ignore, only });
      const body = `
local P = ${P}
local cam = workspace.CurrentCamera
if not cam then return { error = "no CurrentCamera" } end
local vp = cam.ViewportSize
local px, py
if P.x ~= nil and P.y ~= nil then px, py = P.x, P.y
elseif P.nx ~= nil and P.ny ~= nil then px, py = P.nx * vp.X, P.ny * vp.Y
else px, py = vp.X / 2, vp.Y / 2 end
local ray = cam:ViewportPointToRay(px, py)
local rp = RaycastParams.new()
local list = {}
if P.only then for _, p in ipairs(P.only) do local i = resolve(p) if i then list[#list + 1] = i end end rp.FilterType = Enum.RaycastFilterType.Include
elseif P.ignore then for _, p in ipairs(P.ignore) do local i = resolve(p) if i then list[#list + 1] = i end end rp.FilterType = Enum.RaycastFilterType.Exclude end
rp.FilterDescendantsInstances = list
local hit = workspace:Raycast(ray.Origin, ray.Direction * P.range, rp)
if not hit then return { hit = false, screen = { math.floor(px), math.floor(py) }, rayOrigin = v3(ray.Origin), rayDir = v3(ray.Direction) } end
local inst = hit.Instance
local model = inst:FindFirstAncestorWhichIsA("Model")
return {
  hit = true, screen = { math.floor(px), math.floor(py) },
  path = inst:GetFullName(), modelPath = model and model:GetFullName() or nil, class = inst.ClassName,
  position = v3(hit.Position), normal = v3(hit.Normal), distance = round((hit.Position - ray.Origin).Magnitude),
  partCFrame = cf12(inst.CFrame), partSize = v3(inst.Size), partOrientation = degs(inst.CFrame), material = hit.Material.Name,
}
`;
      const { data, error } = await probe(place, body);
      if (error) return errorText(`pick failed: ${error}`);
      if (data?.error) return errorText(`pick: ${data.error}`);
      return text(JSON.stringify(data, null, 2));
    },
  );

  // ---- objects_in_region (read) ---------------------------------------------
  server.registerTool(
    "objects_in_region",
    {
      description:
        "List parts whose bounds overlap a region: a box (center+size), a sphere (center+radius), or 'around' an instance (its bounding box, optionally padded). Spatial query for \"what's near X / inside this area\". Returns part paths + world pos + size. Read-only.",
      inputSchema: {
        center: z.array(z.number()).length(3).optional().describe("[x,y,z] region center"),
        size: z.array(z.number()).length(3).optional().describe("[x,y,z] box size (box mode)"),
        radius: z.number().optional().describe("sphere radius (sphere mode)"),
        around: z.string().optional().describe("instance path — use its bounding box as the region"),
        pad: z.number().optional().describe("grow the 'around' box by this many studs each side"),
        maxParts: z.number().int().min(1).max(500).optional().describe("default 100"),
        ignore: z.array(z.string()).optional(),
        classFilter: z.string().optional().describe("IsA filter"),
        place: placeArg,
      },
    },
    async ({ center, size, radius, around, pad, maxParts, ignore, classFilter, place }) => {
      const P = lua({ center, size, radius, around, pad, maxParts: maxParts ?? 100, ignore, classFilter });
      const body = `
local P = ${P}
local center, size
if P.around then
  local a = resolve(P.around)
  if not a then return { error = "around not found: " .. tostring(P.around) } end
  if a:IsA("Model") then local cf, sz = a:GetBoundingBox() center, size = cf.Position, sz
  elseif a:IsA("BasePart") then center, size = a.Position, a.Size
  else return { error = "around must be a Model or BasePart" } end
  if P.pad then size = size + Vector3.new(P.pad * 2, P.pad * 2, P.pad * 2) end
end
if P.center then center = Vector3.new(P.center[1], P.center[2], P.center[3]) end
local op = OverlapParams.new()
op.MaxParts = P.maxParts
local ig = {}
if P.ignore then for _, p in ipairs(P.ignore) do local i = resolve(p) if i then ig[#ig + 1] = i end end end
op.FilterType = Enum.RaycastFilterType.Exclude
op.FilterDescendantsInstances = ig
local parts
if P.radius and P.radius > 0 then
  if not center then return { error = "radius mode needs center or around" } end
  parts = workspace:GetPartBoundsInRadius(center, P.radius, op)
elseif P.size or size then
  if not center then return { error = "box mode needs center or around" } end
  local sz = P.size and Vector3.new(P.size[1], P.size[2], P.size[3]) or size
  parts = workspace:GetPartBoundsInBox(CFrame.new(center), sz, op)
else
  return { error = "provide center+size (box), center+radius (sphere), or around" }
end
local out = {}
for _, prt in ipairs(parts) do
  if (not P.classFilter) or prt:IsA(P.classFilter) then
    out[#out + 1] = { path = prt:GetFullName(), class = prt.ClassName, world = v3(prt.Position), size = v3(prt.Size) }
  end
end
return { center = center and v3(center) or nil, count = #out, parts = out, maxPartsHit = #parts >= P.maxParts }
`;
      const { data, error } = await probe(place, body);
      if (error) return errorText(`objects_in_region failed: ${error}`);
      if (data?.error) return errorText(`objects_in_region: ${data.error}`);
      const note = data?.maxPartsHit ? "  (maxParts reached — narrow the region or raise maxParts)" : "";
      return text(`${data?.count ?? 0} part(s) in region${note}\n${JSON.stringify(data?.parts ?? [], null, 2)}`);
    },
  );

  // ---- place_on (write) ------------------------------------------------------
  server.registerTool(
    "place_on",
    {
      description:
        "Compute and apply an accurate placement: raycast to a surface (a screen point, a target instance's TOP via onTarget, or straight down via ground), then sit the object FLUSH on it — offset by the object's bounding box so it doesn't clip or float. Optional alignToNormal (rotate to the surface) and snap (grid studs). Use dryRun to get the computed CFrame without moving. Moves a Part (CFrame) or a Model (PivotTo, bbox-center flush). Write tool.",
      inputSchema: {
        path: z.string().describe("the instance to place (BasePart or Model)"),
        x: z.number().optional().describe("screen X px (screen-ray mode)"),
        y: z.number().optional().describe("screen Y px"),
        nx: z.number().optional().describe("normalized X 0..1"),
        ny: z.number().optional().describe("normalized Y 0..1"),
        onTarget: z.string().optional().describe("place on the TOP surface of this instance"),
        ground: z.boolean().optional().describe("drop straight down from the object's current X,Z onto whatever's below"),
        alignToNormal: z.boolean().optional().describe("rotate the object to sit flush on a sloped surface (default false)"),
        snap: z.number().optional().describe("snap final X,Z to this grid (studs)"),
        extraOffset: z.number().optional().describe("extra gap above the surface (studs, default 0)"),
        dryRun: z.boolean().optional().describe("compute + return the CFrame without moving anything"),
        ignore: z.array(z.string()).optional().describe("extra instances the ray should ignore"),
        range: z.number().optional().describe("ray length (default 5000)"),
        place: placeArg,
      },
    },
    async ({ path, x, y, nx, ny, onTarget, ground, alignToNormal, snap, extraOffset, dryRun, ignore, range, place }) => {
      const P = lua({
        path, x, y, nx, ny, onTarget, ground,
        alignToNormal: alignToNormal === true,
        snap, extraOffset: extraOffset ?? 0, dryRun: dryRun === true, ignore, range: range ?? 5000,
      });
      const body = `
local P = ${P}
local obj = resolve(P.path)
if not obj then return { error = "object not found: " .. tostring(P.path) } end
local isModel = obj:IsA("Model")
if not isModel and not obj:IsA("BasePart") then return { error = "path must be a BasePart or Model" } end
local ocf, osize
if isModel then ocf, osize = obj:GetBoundingBox() else ocf, osize = obj.CFrame, obj.Size end

local point, normal
if P.onTarget then
  local t = resolve(P.onTarget)
  if not t then return { error = "onTarget not found: " .. tostring(P.onTarget) } end
  local tcf, tsize
  if t:IsA("Model") then tcf, tsize = t:GetBoundingBox() elseif t:IsA("BasePart") then tcf, tsize = t.CFrame, t.Size else return { error = "onTarget must be a Model or BasePart" } end
  point, normal = tcf.Position + tcf.UpVector * (tsize.Y / 2), tcf.UpVector
else
  local origin, dir
  if P.ground then
    origin, dir = ocf.Position + Vector3.new(0, 0.1, 0), Vector3.new(0, -1, 0) * P.range
  else
    local cam = workspace.CurrentCamera
    if not cam then return { error = "screen mode needs a camera — use onTarget or ground instead" } end
    local vp = cam.ViewportSize
    local px, py
    if P.x ~= nil and P.y ~= nil then px, py = P.x, P.y
    elseif P.nx ~= nil and P.ny ~= nil then px, py = P.nx * vp.X, P.ny * vp.Y
    else px, py = vp.X / 2, vp.Y / 2 end
    local ray = cam:ViewportPointToRay(px, py)
    origin, dir = ray.Origin, ray.Direction * P.range
  end
  local rp = RaycastParams.new()
  rp.FilterType = Enum.RaycastFilterType.Exclude
  local ex = { obj }
  if P.ignore then for _, p in ipairs(P.ignore) do local i = resolve(p) if i then ex[#ex + 1] = i end end end
  rp.FilterDescendantsInstances = ex
  local hit = workspace:Raycast(origin, dir, rp)
  if not hit then return { error = "no surface hit under that point within range" } end
  point, normal = hit.Position, hit.Normal
end
local n = normal.Unit

local rot
if P.alignToNormal then
  local up = n
  local look = ocf.LookVector
  local fwd = look - up * look:Dot(up)
  if fwd.Magnitude < 1e-3 then fwd = Vector3.new(0, 0, -1) - up * Vector3.new(0, 0, -1):Dot(up) end
  if fwd.Magnitude < 1e-3 then fwd = Vector3.new(1, 0, 0) - up * Vector3.new(1, 0, 0):Dot(up) end
  fwd = fwd.Unit
  local right = fwd:Cross(up).Unit
  rot = CFrame.fromMatrix(Vector3.new(), right, up, right:Cross(up).Unit)
else
  rot = ocf.Rotation
end

local half = math.abs(rot.RightVector:Dot(n)) * osize.X / 2 + math.abs(rot.UpVector:Dot(n)) * osize.Y / 2 + math.abs(rot.LookVector:Dot(n)) * osize.Z / 2
local pos = point + n * (half + P.extraOffset)
if P.snap and P.snap > 0 then
  pos = Vector3.new(math.floor(pos.X / P.snap + 0.5) * P.snap, pos.Y, math.floor(pos.Z / P.snap + 0.5) * P.snap)
end
local finalCF = CFrame.new(pos) * rot

if P.dryRun then
  return { dryRun = true, computedCFrame = finalCF, center = v3(pos), normal = v3(n), halfExtent = round(half), aligned = P.alignToNormal }
end

local CHS = game:GetService("ChangeHistoryService")
local rec = CHS:TryBeginRecording("TufanBridge: place_on " .. obj.Name)
local ok, err = pcall(function()
  if isModel then
    local pivotToCenter = ocf:ToObjectSpace(obj:GetPivot())
    obj:PivotTo(finalCF * pivotToCenter)
  else
    obj.CFrame = finalCF
  end
end)
if rec then CHS:FinishRecording(rec, ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel) end
if not ok then return { error = "apply failed: " .. tostring(err) } end
return { placed = true, path = obj:GetFullName(), center = v3(pos), normal = v3(n), halfExtent = round(half), aligned = P.alignToNormal, anchoredWarning = (not isModel and not obj.Anchored) or nil }
`;
      const target = resolveTargetPlace(place);
      if (target.error) return errorText(target.error);
      let data: any;
      try {
        const r: any = await dispatchTo(target.placeId!, "runLuau", { code: PRELUDE + body });
        data = r?.resultJson;
      } catch (e) {
        return errorText(`place_on failed: ${(e as Error).message}`);
      }
      if (!data) return errorText("place_on: no result from Studio");
      if (data.error) return errorText(`place_on: ${data.error}`);
      if (!data.dryRun) bumpPlace(target.placeId!);
      if (data.dryRun) {
        return text(
          `dryRun — computed flush placement at center [${(data.center ?? []).join(", ")}], surface normal [${(data.normal ?? []).join(", ")}], half-extent ${data.halfExtent}${data.aligned ? ", aligned to surface" : ""}.\nRe-run without dryRun to apply.\n${JSON.stringify({ computedCFrame: data.computedCFrame }, null, 2)}`,
        );
      }
      const warn = data.anchoredWarning ? "  ⚠ part is unanchored — physics may move it; anchor it to keep the placement." : "";
      return text(`Placed ${data.path} flush — center [${(data.center ?? []).join(", ")}], normal [${(data.normal ?? []).join(", ")}]${data.aligned ? ", aligned to surface" : ""}.${warn}`);
    },
  );
}
