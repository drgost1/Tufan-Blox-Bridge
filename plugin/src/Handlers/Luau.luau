--!nocheck
local LogService = game:GetService("LogService")
local Serialize = require(script.Parent.Parent.Serialize.Instance)

return function(register)
	register("runLuau", function(args)
		local fn, compileErr = loadstring(args.code)
		if not fn then
			error("compile error: " .. tostring(compileErr))
		end

		-- Capture prints emitted during execution.
		local logs = {}
		local conn = LogService.MessageOut:Connect(function(message, _type)
			table.insert(logs, message)
		end)

		-- Watchdog: user code may yield forever (timeout-less WaitForChild, :Wait()).
		-- pcall catches errors but NOT infinite yields, so run it on a child
		-- coroutine and race a deadline. The scheduler resumes the coroutine across
		-- its yields and pcall(fn) runs to completion inside it, so legitimately
		-- yielding code still returns its value. A timed-out coroutine can't be
		-- killed in Luau — we stop waiting and return a clear error (kept below the
		-- server's 90s command timeout). Tight non-yielding loops are already caught
		-- by Luau's own execution-time guard, which pcall catches.
		local budget = tonumber(args.timeoutBudget) or 30
		local done, ok, result = false, nil, nil
		local co = coroutine.create(function()
			ok, result = pcall(fn)
			done = true
		end)
		coroutine.resume(co)
		local deadline = os.clock() + budget
		while not done and os.clock() < deadline do
			task.wait()
		end

		task.wait() -- let queued MessageOut events flush
		conn:Disconnect()

		if not done then
			error(string.format("execution exceeded %ds budget — likely an unbounded WaitForChild/:Wait/loop. Pass timeoutBudget to extend.", budget))
		end
		if not ok then
			error("runtime error: " .. tostring(result))
		end

		-- Structured result: tables/Roblox-types come back as real JSON data
		-- (not tostring'd) so the AI can read fields directly. Primitives keep
		-- the old `result` string for back-compat.
		local resultStr, resultJson
		if result ~= nil then
			if typeof(result) == "table" then
				local okEnc, enc = pcall(Serialize.encodeDeep, result)
				resultJson = okEnc and enc or nil
				if not okEnc then resultStr = tostring(result) end
			else
				local okEncode, encoded = pcall(function()
					if typeof(result) == "Instance" then return result:GetFullName() end
					return tostring(result)
				end)
				resultStr = okEncode and encoded or tostring(result)
			end
		end

		return { result = resultStr, resultJson = resultJson, logs = logs }
	end)
end
