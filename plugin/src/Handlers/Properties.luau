--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local ChangeHistoryService = game:GetService("ChangeHistoryService")

-- Yield every N items inside big batches. The plugin runs on Studio's single
-- main thread; a multi-thousand-item loop with no yield starves the poll loop
-- (same thread) past the server's liveness window → false "plugin unresponsive"
-- + disconnect. A bare task.wait() hands a frame back so the next /poll fires,
-- keeping the session alive. The batch still completes; it just breathes.
local YIELD_EVERY = 250

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
		local errors = {}
		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: mass set " .. args.name)
		for i, path in ipairs(args.paths) do
			local inst, rerr = Serialize.resolve(path)
			if inst then
				local ok, perr = pcall(function() inst[args.name] = Serialize.decodeValue(args.value) end)
				if ok then
					count += 1
				else
					table.insert(errors, { index = i, path = path, name = args.name, reason = tostring(perr) })
				end
			else
				table.insert(errors, { index = i, path = path, name = args.name, reason = rerr or "unresolved path" })
			end
			if i % YIELD_EVERY == 0 then task.wait() end
		end
		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		return { count = count, failed = #errors, errors = errors }
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
		local applied = 0
		local errors = {}
		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: mass edit (" .. #edits .. ")")
		for i, e in ipairs(edits) do
			local inst, rerr
			if e.path then inst, rerr = Serialize.resolve(e.path) end
			if inst then
				local ok, perr = pcall(function() inst[e.name] = Serialize.decodeValue(e.value) end)
				if ok then
					applied += 1
				else
					table.insert(errors, { index = i, path = e.path, name = e.name, reason = tostring(perr) })
				end
			else
				table.insert(errors, { index = i, path = e.path, name = e.name, reason = rerr or "unresolved path" })
			end
			if i % YIELD_EVERY == 0 then task.wait() end
		end
		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		return { applied = applied, failed = #errors, errors = errors }
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

	-- Batch attribute edits in ONE round-trip + ONE undo: edits = {{path, name, value}}.
	-- Mirror of massEdit but for attributes; returns a per-item errors list.
	register("massSetAttribute", function(args)
		local edits = args.edits or {}
		local applied = 0
		local errors = {}
		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: mass set attribute (" .. #edits .. ")")
		for i, e in ipairs(edits) do
			local inst, rerr
			if e.path then inst, rerr = Serialize.resolve(e.path) end
			if inst then
				local ok, perr = pcall(function() inst:SetAttribute(e.name, Serialize.decodeValue(e.value)) end)
				if ok then
					applied += 1
				else
					table.insert(errors, { index = i, path = e.path, name = e.name, reason = tostring(perr) })
				end
			else
				table.insert(errors, { index = i, path = e.path, name = e.name, reason = rerr or "unresolved path" })
			end
			if i % YIELD_EVERY == 0 then task.wait() end
		end
		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		return { applied = applied, failed = #errors, errors = errors }
	end)

	register("searchMaterials", function(args)
		local MaterialService = game:GetService("MaterialService")
		local filter = args.name and string.lower(args.name) or nil
		local out = {}
		for _, m in ipairs(MaterialService:GetDescendants()) do
			if m:IsA("MaterialVariant") then
				if (not filter) or string.find(string.lower(m.Name), filter, 1, true) then
					local base = "?"
					pcall(function() base = m.BaseMaterial and m.BaseMaterial.Name or "?" end)
					table.insert(out, { name = m.Name, baseMaterial = base })
				end
			end
		end
		return { materials = out }
	end)
end
