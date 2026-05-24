--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local ChangeHistoryService = game:GetService("ChangeHistoryService")

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
end
