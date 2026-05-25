--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local ChangeHistoryService = game:GetService("ChangeHistoryService")

-- Yield every N built/cloned instances so a big batch doesn't starve the single
-- main thread (and with it the poll loop → false "unresponsive"/disconnect).
local YIELD_EVERY = 250

local function recording(name, fn)
	local recordingId = ChangeHistoryService:TryBeginRecording(name)
	local ok, result = pcall(fn)
	if recordingId then
		ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
	end
	if not ok then error(result) end
	return result
end

return function(register)
	register("createInstance", function(args)
		return recording("TufanBridge: create " .. args.className, function()
			local parent, err = Serialize.resolveParent(args.parentPath)
			if not parent then error(err) end
			local inst = Instance.new(args.className)
			if args.name then inst.Name = args.name end
			if type(args.properties) == "table" then
				for k, v in pairs(args.properties) do
					pcall(function() inst[k] = Serialize.decodeValue(v) end)
				end
			end
			inst.Parent = parent
			return { path = Serialize.uniquePath(inst) }
		end)
	end)

	register("deleteInstance", function(args)
		return recording("TufanBridge: delete", function()
			local inst, err = Serialize.resolve(args.path)
			if not inst then error(err) end
			inst:Destroy()
			return { ok = true }
		end)
	end)

	register("cloneInstance", function(args)
		return recording("TufanBridge: clone", function()
			local inst, err = Serialize.resolve(args.path)
			if not inst then error(err) end
			local clone = inst:Clone()
			local parent = inst.Parent
			if args.parentPath then
				local p, perr = Serialize.resolveParent(args.parentPath)
				if not p then error(perr) end
				parent = p
			end
			clone.Parent = parent
			return { path = Serialize.uniquePath(clone) }
		end)
	end)

	register("moveInstance", function(args)
		return recording("TufanBridge: move", function()
			local inst, err = Serialize.resolve(args.path)
			if not inst then error(err) end
			local parent, perr = Serialize.resolveParent(args.newParentPath)
			if not parent then error(perr) end
			inst.Parent = parent
			return { path = Serialize.uniquePath(inst) }
		end)
	end)

	register("renameInstance", function(args)
		return recording("TufanBridge: rename", function()
			local inst, err = Serialize.resolve(args.path)
			if not inst then error(err) end
			inst.Name = args.newName
			return { path = Serialize.uniquePath(inst) }
		end)
	end)

	-- Create many instances in ONE undo entry. items = {{className, parentPath, name, properties}}
	register("massCreate", function(args)
		return recording("TufanBridge: mass create", function()
			local paths = {}
			for i, item in ipairs(args.items or {}) do
				local parent = Serialize.resolveParent(item.parentPath)
				if parent and item.className then
					local inst = Instance.new(item.className)
					if item.name then inst.Name = item.name end
					if type(item.properties) == "table" then
						for k, v in pairs(item.properties) do
							pcall(function() inst[k] = Serialize.decodeValue(v) end)
						end
					end
					inst.Parent = parent
					table.insert(paths, Serialize.uniquePath(inst))
				end
				if i % YIELD_EVERY == 0 then task.wait() end
			end
			return { paths = paths, created = #paths }
		end)
	end)

	-- Clone one instance `count` times into its parent (or parentPath).
	register("massDuplicate", function(args)
		return recording("TufanBridge: mass duplicate", function()
			local inst, err = Serialize.resolve(args.path)
			if not inst then error(err) end
			local parent = inst.Parent
			if args.parentPath then
				local p = Serialize.resolveParent(args.parentPath)
				if p then parent = p end
			end
			local count = math.max(1, args.count or 1)
			local paths = {}
			for i = 1, count do
				local clone = inst:Clone()
				clone.Parent = parent
				table.insert(paths, Serialize.uniquePath(clone))
				if i % YIELD_EVERY == 0 then task.wait() end
			end
			return { paths = paths, created = #paths }
		end)
	end)

	-- Build a whole nested subtree from one spec in ONE call + ONE undo.
	-- spec = { className, name?, properties?, children? = { spec, ... } }
	-- Great for UIs (a panel + all its frames/labels at once).
	register("createTree", function(args)
		return recording("TufanBridge: create tree", function()
			local parent, err = Serialize.resolveParent(args.parentPath)
			if not parent then error(err) end
			local created = 0
			local function build(spec, par)
				if type(spec) ~= "table" or not spec.className then return nil end
				local inst = Instance.new(spec.className)
				if spec.name then inst.Name = spec.name end
				if type(spec.properties) == "table" then
					for k, v in pairs(spec.properties) do
						pcall(function() inst[k] = Serialize.decodeValue(v) end)
					end
				end
				inst.Parent = par
				created += 1
				if created % YIELD_EVERY == 0 then task.wait() end
				if type(spec.children) == "table" then
					for _, child in ipairs(spec.children) do
						build(child, inst)
					end
				end
				return inst
			end
			-- Defensive: some MCP clients pass the nested spec as a JSON string.
			local spec = args.tree
			if type(spec) == "string" then
				local ok, decoded = pcall(function() return game:GetService("HttpService"):JSONDecode(spec) end)
				if ok then spec = decoded end
			end
			local root = build(spec, parent)
			if not root then error("invalid tree spec (need { className, ... })") end
			return { path = Serialize.uniquePath(root), created = created }
		end)
	end)

	register("undo", function()
		ChangeHistoryService:Undo()
		return { ok = true }
	end)

	register("redo", function()
		ChangeHistoryService:Redo()
		return { ok = true }
	end)
end
