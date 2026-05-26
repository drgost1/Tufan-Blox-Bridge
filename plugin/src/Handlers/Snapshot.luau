--!nocheck
-- Snapshots: checkpoint a subtree, restore it instantly. A real undo across the
-- AI boundary — lets the AI make bold changes and roll back even after Studio's
-- own undo stack has moved on. Snapshots are kept as live clones in
-- ServerStorage._TufanSnapshots (in-place, so they're robust and exact); restore
-- destroys the current node and re-clones the checkpoint into its original spot.
local ServerStorage = game:GetService("ServerStorage")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Serialize = require(script.Parent.Parent.Serialize.Instance)

local FOLDER = "_TufanSnapshots"

local function store()
	local f = ServerStorage:FindFirstChild(FOLDER)
	if not f then
		f = Instance.new("Folder")
		f.Name = FOLDER
		f.Parent = ServerStorage
	end
	return f
end

-- Clone an instance even if it (or descendants) have Archivable=false.
local function archivableClone(inst)
	local touched = {}
	for _, d in ipairs(inst:GetDescendants()) do
		if not d.Archivable then
			d.Archivable = true
			table.insert(touched, d)
		end
	end
	local rootWas = inst.Archivable
	inst.Archivable = true
	local clone = inst:Clone()
	inst.Archivable = rootWas
	for _, d in ipairs(touched) do
		d.Archivable = false
	end
	return clone
end

return function(register)
	register("snapshot", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		local name = args.name or (inst.Name .. "_" .. os.time())
		local folder = store()

		local existing = folder:FindFirstChild(name)
		if existing then existing:Destroy() end

		local clone = archivableClone(inst)
		if not clone then error("could not clone " .. args.path .. " (Archivable?)") end

		-- record where it came from so restore knows where to put it back
		local parentPath = inst.Parent and Serialize.uniquePath(inst.Parent) or "game"
		clone.Name = name
		clone:SetAttribute("TufanOrigParent", parentPath)
		clone:SetAttribute("TufanOrigName", inst.Name)
		clone:SetAttribute("TufanTime", os.time())
		clone:SetAttribute("TufanCount", #inst:GetDescendants())
		clone.Parent = folder

		return { ok = true, name = name, origParent = parentPath, descendants = #clone:GetDescendants() }
	end)

	register("restore", function(args)
		local folder = store()
		local snap = folder:FindFirstChild(args.name)
		if not snap then error("no snapshot named '" .. tostring(args.name) .. "'") end

		local parentPath = args.parentPath or snap:GetAttribute("TufanOrigParent") or "game"
		local origName = snap:GetAttribute("TufanOrigName") or args.name
		local parent, perr = Serialize.resolveParent(parentPath)
		if not parent then error("restore target parent missing: " .. tostring(perr)) end

		return (function()
			local recId = ChangeHistoryService:TryBeginRecording("TufanBridge: restore " .. args.name)
			-- remove the current occupant at the original location
			local current = parent:FindFirstChild(origName)
			if current then current:Destroy() end
			-- clone the checkpoint back, strip bookkeeping attributes
			local restored = archivableClone(snap)
			restored.Name = origName
			restored:SetAttribute("TufanOrigParent", nil)
			restored:SetAttribute("TufanOrigName", nil)
			restored:SetAttribute("TufanTime", nil)
			restored:SetAttribute("TufanCount", nil)
			restored.Parent = parent
			if recId then
				ChangeHistoryService:FinishRecording(recId, Enum.FinishRecordingOperation.Commit)
			end
			return { ok = true, path = Serialize.uniquePath(restored) }
		end)()
	end)

	register("listSnapshots", function()
		local folder = store()
		local out = {}
		for _, snap in ipairs(folder:GetChildren()) do
			table.insert(out, {
				name = snap.Name,
				className = snap.ClassName,
				origParent = snap:GetAttribute("TufanOrigParent"),
				origName = snap:GetAttribute("TufanOrigName"),
				time = snap:GetAttribute("TufanTime"),
				descendants = snap:GetAttribute("TufanCount"),
			})
		end
		return { snapshots = out }
	end)

	register("deleteSnapshot", function(args)
		local folder = store()
		local snap = folder:FindFirstChild(args.name)
		if not snap then error("no snapshot named '" .. tostring(args.name) .. "'") end
		snap:Destroy()
		return { ok = true }
	end)
end
