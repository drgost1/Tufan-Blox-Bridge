--!nocheck
-- Tufan's responsive engine. Two handlers:
--   makeResponsive — convert a UI subtree Offset<->Scale (validated formula), with
--     the recipe a paid plugin uses (+ the gaps it misses: CellPadding, real UIScale
--     driver, true fit). Skips runtime-driven (draggable) elements. dryRun previews.
--   scanResponsive — read-only audit: what will break on another screen, across the
--     tree AND the scripts, while recognizing intentional draggable/resizable UI.
--
-- Formula (validated to 4 decimals vs UI Tools v2.6.2):
--   UDim2 (Position/Size/CanvasSize/CellSize/CellPadding): Scale = Offset / parentAbs[axis]
--   UIPadding: L/R / parent width, T/B / parent height
--   UICorner CornerRadius: / min(parent width, height)
--   inverse: Offset = round(Scale * parentAbs)
local CollectionService = game:GetService("CollectionService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Serialize = require(script.Parent.Parent.Serialize.Instance)

local MIN_TAP = 44

local function u2off2scale(u, abs)
	return UDim2.new(
		u.X.Scale + (abs.X > 0 and u.X.Offset / abs.X or 0), 0,
		u.Y.Scale + (abs.Y > 0 and u.Y.Offset / abs.Y or 0), 0)
end
local function u2scale2off(u, abs)
	return UDim2.new(0, math.round(u.X.Offset + u.X.Scale * abs.X), 0, math.round(u.Y.Offset + u.Y.Scale * abs.Y))
end
local function udOff2scale(u, ref) return UDim.new(u.Scale + (ref > 0 and u.Offset / ref or 0), 0) end
local function udScale2off(u, ref) return UDim.new(0, math.round(u.Offset + u.Scale * ref)) end

local function isPureOffset2(u) return u.X.Scale == 0 and u.Y.Scale == 0 and (u.X.Offset ~= 0 or u.Y.Offset ~= 0) end

-- runtime-driven = positioned/sized by code at runtime (draggable/resizable). Never
-- force-scale these. v1 signal: a Draggable/Resizable tag, or explicit exclude.
local function isRuntimeDriven(inst, excludeSet)
	if CollectionService:HasTag(inst, "Draggable") or CollectionService:HasTag(inst, "Resizable") then return true end
	if excludeSet[inst] then return true end
	return false
end

local function buildExclude(paths)
	local set = {}
	for _, p in ipairs(paths or {}) do
		local inst = Serialize.resolve(p)
		if inst then set[inst] = true end
	end
	return set
end

return function(register)
	------------------------------------------------------------------ make_responsive
	register("makeResponsive", function(args)
		local root, err = Serialize.resolve(args.path)
		if not root then error(err) end
		local mode = args.mode or "scale"           -- scale | offset | fit | uiscale
		local dryRun = args.dryRun == true
		local doAspect = args.aspectRatio == true
		local doMinSize = args.minSize == true
		local exclude = buildExclude(args.exclude)
		local refRes = args.referenceResolution      -- {x,y} for uiscale mode (default 1280,720)

		local changes = {}
		local function note(path, what, before, after)
			changes[#changes + 1] = { path = path, prop = what, before = before, after = after }
		end

		local nodes = { root }
		for _, d in ipairs(root:GetDescendants()) do nodes[#nodes + 1] = d end

		-- ---- fit mode: only the root, fill its parent (beats the plugin: also pos+anchor)
		if mode == "fit" then
			if not dryRun then
				local rec = ChangeHistoryService:TryBeginRecording("TufanBridge: fit parent")
				root.Size = UDim2.fromScale(1, 1); root.Position = UDim2.fromScale(0, 0); root.AnchorPoint = Vector2.new(0, 0)
				if rec then ChangeHistoryService:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end
			end
			note(Serialize.uniquePath(root), "fit", "-", "Size={1,1} Pos={0,0} Anchor=(0,0)")
			return { ok = true, mode = mode, dryRun = dryRun, changes = changes }
		end

		-- ---- uiscale mode: keep Offset, add a UIScale + a real viewport driver
		if mode == "uiscale" then
			local rx = refRes and refRes.x or 1280
			local ry = refRes and refRes.y or 720
			if not dryRun then
				local rec = ChangeHistoryService:TryBeginRecording("TufanBridge: add UIScale driver")
				local scale = root:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")
				scale.Parent = root
				local driver = root:FindFirstChild("ResponsiveScale")
				if not driver then
					driver = Instance.new("LocalScript"); driver.Name = "ResponsiveScale"; driver.Parent = root
				end
				driver.Source = string.format([[
local REF = Vector2.new(%d, %d)
local scale = script.Parent:FindFirstChildOfClass("UIScale")
local cam = workspace.CurrentCamera
local function fit()
	local v = cam.ViewportSize
	if scale then scale.Scale = math.min(v.X / REF.X, v.Y / REF.Y) end
end
cam:GetPropertyChangedSignal("ViewportSize"):Connect(fit); fit()
]], rx, ry)
				if rec then ChangeHistoryService:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end
			end
			note(Serialize.uniquePath(root), "uiscale", "-", string.format("UIScale + ResponsiveScale driver (ref %dx%d)", rx, ry))
			return { ok = true, mode = mode, dryRun = dryRun, changes = changes }
		end

		-- ---- scale / offset modes: walk + convert per property
		local rec
		if not dryRun then rec = ChangeHistoryService:TryBeginRecording("TufanBridge: make responsive (" .. mode .. ")") end
		local toScale = (mode ~= "offset")

		for _, g in ipairs(nodes) do
			local pAbs = (g.Parent and g.Parent:IsA("GuiBase2d")) and g.Parent.AbsoluteSize or nil

			if g:IsA("GuiObject") and pAbs then
				local runtime = isRuntimeDriven(g, exclude)
				if not runtime then
					-- Position + Size
					local newPos = toScale and u2off2scale(g.Position, pAbs) or u2scale2off(g.Position, pAbs)
					local newSize = toScale and u2off2scale(g.Size, pAbs) or u2scale2off(g.Size, pAbs)
					if not dryRun then g.Position = newPos; g.Size = newSize end
					note(Serialize.uniquePath(g), "Position", tostring(g.Position), tostring(newPos))
					note(Serialize.uniquePath(g), "Size", tostring(g.Size), tostring(newSize))
					-- aspect lock (opt-in) — only if absent + not under a layout parent
					if toScale and doAspect and not g:FindFirstChildOfClass("UIAspectRatioConstraint")
						and not (g.Parent:FindFirstChildOfClass("UIListLayout") or g.Parent:FindFirstChildOfClass("UIGridLayout"))
						and g.AbsoluteSize.Y > 0 then
						if not dryRun then
							local ar = Instance.new("UIAspectRatioConstraint"); ar.AspectRatio = g.AbsoluteSize.X / g.AbsoluteSize.Y; ar.Parent = g
						end
						note(Serialize.uniquePath(g), "+UIAspectRatioConstraint", "-", string.format("%.3f", g.AbsoluteSize.X / math.max(1, g.AbsoluteSize.Y)))
					end
					-- min tap target (opt-in) for buttons
					if toScale and doMinSize and g:IsA("GuiButton") and not g:FindFirstChildOfClass("UISizeConstraint") then
						if not dryRun then
							local sc = Instance.new("UISizeConstraint"); sc.MinSize = Vector2.new(MIN_TAP, MIN_TAP); sc.Parent = g
						end
						note(Serialize.uniquePath(g), "+UISizeConstraint", "-", "44x44 min")
					end
				end
				-- ScrollingFrame CanvasSize (ref = its parent) — safe even if runtime-driven
				if g:IsA("ScrollingFrame") then
					local nc = toScale and u2off2scale(g.CanvasSize, pAbs) or u2scale2off(g.CanvasSize, pAbs)
					if not dryRun then g.CanvasSize = nc end
					note(Serialize.uniquePath(g), "CanvasSize", tostring(g.CanvasSize), tostring(nc))
				end

			elseif g:IsA("UIGridLayout") and g.Parent and g.Parent:IsA("GuiBase2d") then
				local a = g.Parent.AbsoluteSize
				local ncs = toScale and u2off2scale(g.CellSize, a) or u2scale2off(g.CellSize, a)
				local ncp = toScale and u2off2scale(g.CellPadding, a) or u2scale2off(g.CellPadding, a)
				if not dryRun then g.CellSize = ncs; g.CellPadding = ncp end
				note(Serialize.uniquePath(g), "CellSize", tostring(g.CellSize), tostring(ncs))
				note(Serialize.uniquePath(g), "CellPadding", tostring(g.CellPadding), tostring(ncp))

			elseif g:IsA("UIPadding") and g.Parent and g.Parent:IsA("GuiBase2d") then
				local a = g.Parent.AbsoluteSize
				local L = toScale and udOff2scale(g.PaddingLeft, a.X) or udScale2off(g.PaddingLeft, a.X)
				local R = toScale and udOff2scale(g.PaddingRight, a.X) or udScale2off(g.PaddingRight, a.X)
				local T = toScale and udOff2scale(g.PaddingTop, a.Y) or udScale2off(g.PaddingTop, a.Y)
				local B = toScale and udOff2scale(g.PaddingBottom, a.Y) or udScale2off(g.PaddingBottom, a.Y)
				if not dryRun then g.PaddingLeft = L; g.PaddingRight = R; g.PaddingTop = T; g.PaddingBottom = B end
				note(Serialize.uniquePath(g), "Padding", "L/R/T/B", "converted")

			elseif g:IsA("UICorner") and g.Parent and g.Parent:IsA("GuiBase2d") then
				local a = g.Parent.AbsoluteSize
				local ref = math.min(a.X, a.Y)
				local nr = toScale and udOff2scale(g.CornerRadius, ref) or udScale2off(g.CornerRadius, ref)
				if not dryRun then g.CornerRadius = nr end
				note(Serialize.uniquePath(g), "CornerRadius", tostring(g.CornerRadius), tostring(nr))
			end
		end

		if rec then ChangeHistoryService:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end
		return { ok = true, mode = mode, dryRun = dryRun, count = #changes, changes = changes }
	end)

	------------------------------------------------------------------ scan_responsive
	register("scanResponsive", function(args)
		local root, err = Serialize.resolve(args.path)
		if not root then error(err) end

		-- which element names do scripts position/size at runtime? (drag/resize) — so we
		-- DON'T flag those as "missing scale"; instead we note them as intentional.
		local driverHints = {}
		local codeIssues = {}
		for _, d in ipairs(game:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				local ok, src = pcall(function() return d.Source end)
				if ok and src then
					local dragging = src:find("InputChanged") or src:find("Dragging") or src:find("UserInputService")
					if dragging and (src:find("%.Position%s*=") or src:find("%.Size%s*=")) then
						local clamps = src:find("ViewportSize") or src:find("math.clamp") or src:find("AbsoluteSize")
						codeIssues[#codeIssues + 1] = {
							script = Serialize.uniquePath(d),
							kind = "runtime drag/resize",
							clampsToViewport = clamps ~= nil,
						}
					end
					-- runtime pixel positioning (offset assigned to Position/Size at runtime)
					if src:find("UDim2%.fromOffset") or src:find("UDim2%.new%(%s*0%s*,") then
						if src:find("%.Position%s*=") or src:find("%.Size%s*=") then
							codeIssues[#codeIssues + 1] = { script = Serialize.uniquePath(d), kind = "runtime pixel positioning (UDim2.fromOffset)" }
						end
					end
				end
			end
		end

		local findings = {}
		local function flag(sev, path, msg) findings[#findings + 1] = { sev = sev, path = path, msg = msg } end

		local nodes = { root }
		for _, x in ipairs(root:GetDescendants()) do nodes[#nodes + 1] = x end
		local counts = { offsetPos = 0, offsetSize = 0, noAspect = 0, smallTap = 0, offsetCanvas = 0, offsetCell = 0, offsetPad = 0, offsetCorner = 0, draggable = 0 }

		for _, g in ipairs(nodes) do
			if g:IsA("GuiObject") then
				local runtime = CollectionService:HasTag(g, "Draggable") or CollectionService:HasTag(g, "Resizable")
				if runtime then
					counts.draggable += 1
				else
					if isPureOffset2(g.Position) then counts.offsetPos += 1; flag(2, Serialize.uniquePath(g), "Position is pure Offset (won't move with resolution)") end
					if isPureOffset2(g.Size) then counts.offsetSize += 1; flag(2, Serialize.uniquePath(g), "Size is pure Offset (won't scale)") end
					if g:IsA("GuiButton") then
						local a = g.AbsoluteSize
						if (a.X > 0 and a.X < MIN_TAP or a.Y > 0 and a.Y < MIN_TAP) and not g:FindFirstChildOfClass("UISizeConstraint") then
							counts.smallTap += 1; flag(3, Serialize.uniquePath(g), string.format("tap target %dx%d < 44 (add UISizeConstraint)", a.X, a.Y))
						end
					end
				end
				if g:IsA("ScrollingFrame") and isPureOffset2(g.CanvasSize) then counts.offsetCanvas += 1; flag(2, Serialize.uniquePath(g), "CanvasSize is Offset") end
			elseif g:IsA("UIGridLayout") then
				if isPureOffset2(g.CellSize) then counts.offsetCell += 1; flag(2, Serialize.uniquePath(g.Parent), "UIGridLayout CellSize is Offset") end
				if isPureOffset2(g.CellPadding) then counts.offsetPad += 1; flag(1, Serialize.uniquePath(g.Parent), "UIGridLayout CellPadding is Offset (grid gaps won't scale)") end
			elseif g:IsA("UIPadding") then
				if g.PaddingLeft.Scale == 0 and g.PaddingLeft.Offset ~= 0 then counts.offsetPad += 1; flag(1, Serialize.uniquePath(g.Parent), "UIPadding is Offset") end
			elseif g:IsA("UICorner") then
				if g.CornerRadius.Scale == 0 and g.CornerRadius.Offset ~= 0 then counts.offsetCorner += 1; flag(1, Serialize.uniquePath(g.Parent), "UICorner CornerRadius is Offset") end
			end
		end

		return { counts = counts, findings = findings, codeIssues = codeIssues }
	end)
end
