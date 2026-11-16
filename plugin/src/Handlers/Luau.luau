--!nocheck
local LogService = game:GetService("LogService")
local Serialize = require(script.Parent.Parent.Serialize.Instance)

-- checkpoint() yields once this many milliseconds have run without a yield.
local CHECKPOINT_MS = 50
-- A first stretch longer than this gets a warning in the reply (Studio's
-- "not responding" prompt appears after roughly ten seconds).
local WARN_STRETCH_SECONDS = 2

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

		-- Studio runs plugin code on its main thread and shows "plugin is not
		-- responding" when a stretch runs for seconds without yielding (a long
		-- raycast or build loop). Luau can't preempt it, so the code gets a
		-- checkpoint() global: call it inside long loops and it yields one frame
		-- whenever CHECKPOINT_MS have passed since its last yield.
		local lastYield = os.clock()
		local function checkpoint(intervalMs)
			if (os.clock() - lastYield) * 1000 >= (tonumber(intervalMs) or CHECKPOINT_MS) then
				task.wait()
				lastYield = os.clock()
			end
		end
		local env = setmetatable({ checkpoint = checkpoint }, { __index = getfenv(fn) })
		setfenv(fn, env)

		-- Watchdog: user code may yield forever (timeout-less WaitForChild, :Wait()).
		-- pcall catches errors but NOT infinite yields, so run it on a child
		-- coroutine and race a deadline. The scheduler resumes the coroutine across
		-- its yields and pcall(fn) runs to completion inside it, so legitimately
		-- yielding code still returns its value. A timed-out coroutine can't be
		-- killed in Luau — we stop waiting and return a clear error (kept below the
		-- server's 90s command timeout).
		local budget = tonumber(args.timeoutBudget) or 30
		local done, ok, result = false, nil, nil
		local co = coroutine.create(function()
			ok, result = pcall(fn)
			done = true
		end)
		local deadline = os.clock() + budget
		local firstStart = os.clock()
		coroutine.resume(co)
		-- how long the code held Studio before its first yield (its whole run if it never yields)
		local firstStretch = os.clock() - firstStart
		lastYield = os.clock()
		while not done and os.clock() < deadline do
			task.wait()
		end

		-- MessageOut delivers prints up to two frames late. Only wait for them when
		-- the code could have printed, so plain calls stay fast.
		local code = args.code
		local mayPrint = code:find("print", 1, true) or code:find("warn", 1, true) or code:find("require", 1, true)
		for _ = 1, mayPrint and 3 or 1 do
			task.wait()
		end
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

		local warning
		if firstStretch >= WARN_STRETCH_SECONDS then
			warning = string.format(
				"This code held Studio for %.1fs without yielding; past about 10s Studio asks to stop the plugin. "
					.. "Call checkpoint() inside long loops (it yields every %d ms), or split the work across calls.",
				firstStretch,
				CHECKPOINT_MS
			)
		end

		return { result = resultStr, resultJson = resultJson, logs = logs, warning = warning }
	end)
end
