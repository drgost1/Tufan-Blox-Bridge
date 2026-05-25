--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local ChangeHistoryService = game:GetService("ChangeHistoryService")

-- Roblox has no reflection for "all properties"; when names aren't given we
-- return identity + attributes + a best-effort common set read via pcall.
local COMMON = {
	"Name", "ClassName", "Archivable", "Parent",
	"Enabled", "Disabled", "Visible", "Value", "Text",
	"Position", "Size", "CFrame", "Anchored", "Transparency",
	"Color", "Material", "BrickColor", "Source", "Adornee",
}

return function(register)
	register("getProperties", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end

		local out = { Name = inst.Name, ClassName = inst.ClassName }
		local names = args.names
		if type(names) ~= "table" then
			names = COMMON
			-- attributes too
			local attrs = inst:GetAttributes()
			out.Attributes = {}
			for k, v in pairs(attrs) do
				out.Attributes[k] = Serialize.encodeValue(v)
			end
		end

		for _, name in ipairs(names) do
			local ok, value = pcall(function() return inst[name] end)
			if ok and value ~= nil then
				out[name] = Serialize.encodeValue(value)
			end
		end
		return out
	end)

	register("setProperty", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: set " .. args.name)
		local ok, setErr = pcall(function()
			inst[args.name] = Serialize.decodeValue(args.value)
		end)
		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		if not ok then error("failed to set " .. args.name .. ": " .. tostring(setErr)) end
		return { ok = true }
	end)

	register("massSetProperty", function(args)
		local count = 0
		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: mass set " .. args.name)
		for _, path in ipairs(args.paths) do
			local inst = Serialize.resolve(path)
			if inst then
				local ok = pcall(function() inst[args.name] = Serialize.decodeValue(args.value) end)
				if ok then count += 1 end
			end
		end
		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		return { count = count }
	end)

	register("searchByProperty", function(args)
		local root, err = Serialize.resolveParent(args.rootPath)
		if not root then error(err) end
		local want = Serialize.decodeValue(args.value)
		local paths = {}
		Serialize.forEachDescendantPath(root, function(d, path)
			local ok, value = pcall(function() return d[args.name] end)
			if ok and value == want then
				table.insert(paths, path)
				if #paths >= 500 then return false end
			end
		end)
		return { paths = paths }
	end)

	-- Batch arbitrary edits in ONE round-trip + ONE undo entry: edits = list of
	-- { path, name, value }. Far fewer HTTP requests than N separate setProperty
	-- calls (Roblox HttpService is ~500 req/min — bulk edits hit that fast).
	register("massEdit", function(args)
		local edits = args.edits or {}
		local applied, failed = 0, 0
		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: mass edit (" .. #edits .. ")")
		for _, e in ipairs(edits) do
			local inst = e.path and Serialize.resolve(e.path)
			if inst then
				local ok = pcall(function() inst[e.name] = Serialize.decodeValue(e.value) end)
				if ok then applied += 1 else failed += 1 end
			else
				failed += 1
			end
		end
		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		return { applied = applied, failed = failed }
	end)

	register("getAttributes", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		local out = {}
		for k, v in pairs(inst:GetAttributes()) do
			out[k] = Serialize.encodeValue(v)
		end
		return { attributes = out }
	end)

	register("setAttribute", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: set attribute " .. args.name)
		local ok, setErr = pcall(function()
			inst:SetAttribute(args.name, Serialize.decodeValue(args.value))
		end)
		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		if not ok then error("failed to set attribute: " .. tostring(setErr)) end
		return { ok = true }
	end)
end
