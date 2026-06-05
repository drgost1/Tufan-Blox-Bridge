// Post-insert finishing layer (v0.12) — turns a raw imported Model into a
// game-ready one in ONE canned-Luau round-trip: collapse importer wrappers,
// fix leaked Blender datablock names, recover flat material colors (Roblox
// drops baseColorFactor on GLB import), scale to a stud height, anchor, set
// CollisionFidelity, stamp traceability attributes, and optionally place it.
// All inside a single ChangeHistory recording = one undo step.
//
// Called from finishOperation (openCloud.ts) so BOTH generate_asset and
// import_file inherit it. Server-only; dispatches through the existing runLuau
// op (spatial.ts pattern via luauLiteral.ts) — zero plugin changes.

import { lua, PRELUDE } from "./luauLiteral.js";
import { resolveTargetPlace, dispatchTo } from "./bridge/sessions.js";
import { bumpPlace } from "./bridge/cache.js";

export interface FinishOptions {
  /** Anchor every BasePart (generate_asset default true; import_file opt-in). */
  anchor?: boolean;
  /** Uniform-scale so the bounding-box Y height equals this many studs. */
  targetHeightStuds?: number;
  /** Set on every MeshPart (edit-mode plugin-writable; re-cooks collision). */
  collisionFidelity?: "Default" | "Hull" | "Box" | "PreciseConvexDecomposition";
  /** Collapse single-child Model wrappers + fix leaked datablock names (default true). */
  rename?: boolean;
  /** Traceability attributes stamped on the root (TufanPrompt, TufanAssetId, ...). */
  attributes?: Record<string, string | number>;
  /** Flat-color recovery list from the Blender lint ({name, base_color sRGB 0-1}). */
  recolor?: Array<{ object: string; color: [number, number, number] }>;
  /** Drop straight down onto whatever is below, flush (after scaling). */
  onGround?: boolean;
  /** Explicit world position for the model pivot (mutually exclusive with onGround). */
  position?: [number, number, number];
}

/** True when any finishing op is actually requested (drives import_file's opt-in). */
export function wantsFinishing(o: FinishOptions): boolean {
  return Boolean(
    o.anchor ||
      o.targetHeightStuds ||
      o.collisionFidelity ||
      o.attributes ||
      (o.recolor && o.recolor.length) ||
      o.onGround ||
      o.position,
  );
}

// Exported so finishing-e2e.mjs can drive the EXACT shipped Luau through the
// run_luau tool against a live place without needing API keys.
export const FINISH_BODY = `
local root = resolve(P.path)
if not root then return { error = "finish target not found: " .. tostring(P.path) } end
local CHS = game:GetService("ChangeHistoryService")
local rec = CHS:TryBeginRecording("TufanBridge: finish " .. root.Name)
local changed = {}

-- 1. collapse redundant Model>Model single-child wrappers (importer nesting).
--    Never collapses Model>MeshPart, never eats a real multi-child group.
if P.rename then
  while root:IsA("Model") do
    local kids = root:GetChildren()
    if #kids == 1 and kids[1]:IsA("Model") then
      local inner = kids[1]
      inner.Name = root.Name
      inner.Parent = root.Parent
      root:Destroy()
      root = inner
      changed[#changed + 1] = "collapsed wrapper"
    else
      break
    end
  end
end

-- 2. fix leaked datablock names: a Model wrapping exactly ONE MeshPart whose
--    name differs -> the MeshPart takes the Model's (semantic) name.
if P.rename then
  for _, d in ipairs(root:GetDescendants()) do
    if d:IsA("Model") then
      local mp, count = nil, 0
      for _, g in ipairs(d:GetChildren()) do
        if g:IsA("MeshPart") then mp = g count = count + 1 end
      end
      if count == 1 and mp and mp.Name ~= d.Name then
        changed[#changed + 1] = "renamed " .. mp.Name .. " -> " .. d.Name
        mp.Name = d.Name
      end
    end
  end
end

-- 3. flat-color recovery: only parts WITHOUT a SurfaceAppearance (its absence
--    is the exact signal the importer dropped the flat baseColorFactor).
if P.recolor then
  local parts = {}
  for _, d in ipairs(root:GetDescendants()) do
    if d:IsA("MeshPart") and not d:FindFirstChildWhichIsA("SurfaceAppearance") then parts[#parts + 1] = d end
  end
  if root:IsA("MeshPart") and not root:FindFirstChildWhichIsA("SurfaceAppearance") then parts[#parts + 1] = root end
  for _, entry in ipairs(P.recolor) do
    local want = string.lower(entry.object)
    for _, d in ipairs(parts) do
      local have = string.lower(d.Name)
      if have == want or string.find(have, want, 1, true) or string.find(want, have, 1, true) then
        d.Color = Color3.new(math.clamp(entry.color[1], 0, 1), math.clamp(entry.color[2], 0, 1), math.clamp(entry.color[3], 0, 1))
        changed[#changed + 1] = "recolored " .. d.Name
      end
    end
  end
end

-- 4. scale to target height (bbox Y). Visible in the report either way.
local function bbox(node)
  if node:IsA("Model") then local c, s = node:GetBoundingBox() return c, s end
  return node.CFrame, node.Size
end
if P.targetHeight and P.targetHeight > 0 then
  local _, sz = bbox(root)
  if sz.Y > 1e-3 then
    local factor = P.targetHeight / sz.Y
    local ok, err = pcall(function()
      if root:IsA("Model") then root:ScaleTo(root:GetScale() * factor)
      else
        root.Size = root.Size * factor
      end
    end)
    if ok then
      changed[#changed + 1] = string.format("scaled x%.2f", factor)
    else
      changed[#changed + 1] = "scale FAILED: " .. tostring(err)
    end
  end
end

-- 5/6. anchor + collision fidelity.
local anchored, collided = 0, 0
local function eachPart(fn)
  if root:IsA("BasePart") then fn(root) end
  for _, d in ipairs(root:GetDescendants()) do
    if d:IsA("BasePart") then fn(d) end
  end
end
eachPart(function(d)
  if P.anchor then d.Anchored = true anchored = anchored + 1 end
  if P.collision and d:IsA("MeshPart") then
    local ok = pcall(function() d.CollisionFidelity = Enum.CollisionFidelity[P.collision] end)
    if ok then collided = collided + 1 end
  end
end)
if anchored > 0 then changed[#changed + 1] = "anchored " .. anchored .. " part(s)" end
if collided > 0 then changed[#changed + 1] = "collision=" .. P.collision .. " on " .. collided end

-- 7. traceability attributes on the root.
if P.attrs then
  for k, v in pairs(P.attrs) do pcall(function() root:SetAttribute(k, v) end) end
  changed[#changed + 1] = "attributes stamped"
end

-- 8. placement LAST (depends on final size). onGround = straight-down raycast
--    + flush half-extent (place_on's ground-mode math); position = PivotTo.
if P.position then
  local ok = pcall(function()
    local cf = bbox(root)
    local pivotToCenter = cf:ToObjectSpace(root:IsA("Model") and root:GetPivot() or root.CFrame)
    local target = CFrame.new(P.position[1], P.position[2], P.position[3]) * cf.Rotation
    if root:IsA("Model") then root:PivotTo(target * pivotToCenter) else root.CFrame = target end
  end)
  changed[#changed + 1] = ok and "moved to position" or "position move FAILED"
elseif P.onGround then
  local cf, sz = bbox(root)
  local rp = RaycastParams.new()
  rp.FilterType = Enum.RaycastFilterType.Exclude
  rp.FilterDescendantsInstances = { root }
  local hit = workspace:Raycast(cf.Position + Vector3.new(0, 0.1, 0), Vector3.new(0, -1, 0) * 5000, rp)
  if hit then
    local n = hit.Normal.Unit
    local rot = cf.Rotation
    local half = math.abs(rot.RightVector:Dot(n)) * sz.X / 2 + math.abs(rot.UpVector:Dot(n)) * sz.Y / 2 + math.abs(rot.LookVector:Dot(n)) * sz.Z / 2
    local pos = hit.Position + n * half
    local finalCF = CFrame.new(pos) * rot
    local ok = pcall(function()
      if root:IsA("Model") then
        local pivotToCenter = cf:ToObjectSpace(root:GetPivot())
        root:PivotTo(finalCF * pivotToCenter)
      else
        root.CFrame = finalCF
      end
    end)
    changed[#changed + 1] = ok and "grounded flush" or "grounding FAILED"
  else
    changed[#changed + 1] = "grounding skipped (no surface below)"
  end
end

if rec then CHS:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end
local fcf, fsz = bbox(root)
return { ok = true, finalPath = root:GetFullName(), changed = changed, finalSize = v3(fsz), finalCenter = v3(fcf.Position) }
`;

/**
 * Apply finishing to an inserted instance. Never throws — returns a human
 * report line (and a structured result when available).
 */
export async function finishModel(
  path: string,
  opts: FinishOptions,
  place?: string | number,
): Promise<{ line: string; finalPath?: string }> {
  const target = resolveTargetPlace(place);
  if (target.error) return { line: `(finishing skipped — ${target.error})` };
  const P = lua({
    path,
    anchor: opts.anchor === true,
    targetHeight: opts.targetHeightStuds,
    collision: opts.collisionFidelity,
    rename: opts.rename !== false,
    attrs: opts.attributes,
    recolor: opts.recolor && opts.recolor.length ? opts.recolor : undefined,
    onGround: opts.onGround === true,
    position: opts.position,
  });
  try {
    const r: any = await dispatchTo(target.placeId!, "runLuau", { code: `${PRELUDE}\nlocal P = ${P}\n${FINISH_BODY}` });
    const data = r?.resultJson;
    if (!data) return { line: "(finishing returned no result)" };
    if (data.error) return { line: `(finishing failed: ${data.error})` };
    bumpPlace(target.placeId!);
    // runLuau's encodeDeep serializes Luau arrays as {"1":...,"2":...} objects —
    // normalize before formatting (live-E2E finding).
    const arr = (v: any): any[] =>
      Array.isArray(v)
        ? v
        : v && typeof v === "object"
          ? Object.keys(v)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => v[k])
          : [];
    const sizeArr = arr(data.finalSize);
    const size = sizeArr.length ? `${sizeArr.join(" × ")} studs` : "?";
    const what = arr(data.changed).join(", ") || "nothing to do";
    return { line: `finished: ${what} — final size ${size} at ${data.finalPath}`, finalPath: data.finalPath };
  } catch (e) {
    return { line: `(finishing failed: ${(e as Error).message})` };
  }
}
