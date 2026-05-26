--!nocheck
-- batch: run MANY ops in ONE round-trip (one /poll cycle, one undo entry).
-- The single biggest speed win — a 40-step UI build that was 40 HTTP round-trips
-- becomes 1. Each item is { op = "<internalOp>", args = {...} } and is dispatched
-- through the SAME handler table as a normal command.
--
-- Registered specially in init.luau (it needs the fully-built dispatch table).
local ChangeHistoryService = game:GetService("ChangeHistoryService")

return function(register, _ctx, dispatch)
	register("batch", function(args)
		local ops = args.ops or {}
		local stopOnError = args.stopOnError == true
		local results = table.create(#ops)
		local okCount, failCount = 0, 0

		-- One recording wraps the whole batch -> a single undo entry. Inner handlers
		-- call TryBeginRecording too; Roblox returns nil while one is already active,
		-- so they no-op their own waypoint and fold into this one.
		local recId = ChangeHistoryService:TryBeginRecording(string.format("TufanBridge: batch (%d ops)", #ops))

		for i, item in ipairs(ops) do
			local handler = dispatch[item.op]
			local entry
			if not handler then
				entry = { ok = false, error = "unknown op: " .. tostring(item.op) }
			else
				local ok, res = pcall(handler, item.args or {})
				if ok then
					entry = { ok = true, result = res }
					okCount += 1
				else
					entry = { ok = false, error = tostring(res) }
					failCount += 1
				end
			end
			results[i] = entry
			if not entry.ok and stopOnError then
				break
			end
			-- yield periodically so a big batch doesn't starve the poll loop
			if i % 50 == 0 then
				task.wait()
			end
		end

		if recId then
			ChangeHistoryService:FinishRecording(recId, Enum.FinishRecordingOperation.Commit)
		end
		return { results = results, ok = okCount, failed = failCount, total = #ops }
	end)
end
