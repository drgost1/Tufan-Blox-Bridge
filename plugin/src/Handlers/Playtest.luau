--!nocheck
-- Playtest automation. Two primitives:
--   playtestProbe — run Luau INSIDE a running simulation and get structured data
--     back (player count, positions, values...). Works in Run mode (same DM as
--     edit, so the plugin can read it). The AI's "eyes" during a test.
--   playtestInput — synthetic keyboard/mouse via VirtualInputManager. Input is
--     global to the Studio window, so it can drive the CHARACTER in a manual
--     Play Solo (F5) session — the part Run mode can't give you.
local RunService = game:GetService("RunService")
local LogService = game:GetService("LogService")
local VirtualInputManager = game:GetService("VirtualInputManager")
local Serialize = require(script.Parent.Parent.Serialize.Instance)

return function(register)
	register("playtestProbe", function(args)
		if not RunService:IsRunning() then
			error("no simulation running — call start_playtest first (or use run_luau for edit mode)")
		end
		local code = args.code or "return { players = #game:GetService('Players'):GetPlayers() }"
		local fn, cerr = loadstring(code)
		if not fn then error("compile error: " .. tostring(cerr)) end

		local logs = {}
		local conn = LogService.MessageOut:Connect(function(m) table.insert(logs, m) end)
		-- Watchdog (see runLuau): probe code may yield forever; run it on a child
		-- coroutine raced against a deadline so a stuck probe returns a clear error
		-- instead of leaking a thread until the server's 90s command timeout.
		local budget = tonumber(args.timeoutBudget) or 30
		local done, ok, res = false, nil, nil
		local co = coroutine.create(function()
			ok, res = pcall(fn)
			done = true
		end)
		coroutine.resume(co)
		local deadline = os.clock() + budget
		while not done and os.clock() < deadline do
			task.wait()
		end
		task.wait()
		conn:Disconnect()
		if not done then error(string.format("probe exceeded %ds budget — unbounded WaitForChild/:Wait/loop? Pass timeoutBudget to extend.", budget)) end
		if not ok then error("runtime error: " .. tostring(res)) end

		local result
		if typeof(res) == "table" then
			local okEnc, enc = pcall(Serialize.encodeDeep, res)
			result = okEnc and enc or tostring(res)
		elseif res ~= nil then
			result = (typeof(res) == "Instance") and res:GetFullName() or tostring(res)
		end
		return { result = result, logs = logs, runMode = RunService:IsRunMode() }
	end)

	register("playtestInput", function(args)
		local events = args.events or {}
		local sent = {}
		for _, ev in ipairs(events) do
			local t = ev.type
			if t == "key" then
				local kc = ev.key and Enum.KeyCode[ev.key]
				if kc then
					VirtualInputManager:SendKeyEvent(true, kc, false, game)
					task.wait(ev.duration or 0.1)
					VirtualInputManager:SendKeyEvent(false, kc, false, game)
				end
			elseif t == "keyDown" then
				local kc = ev.key and Enum.KeyCode[ev.key]
				if kc then VirtualInputManager:SendKeyEvent(true, kc, false, game) end
			elseif t == "keyUp" then
				local kc = ev.key and Enum.KeyCode[ev.key]
				if kc then VirtualInputManager:SendKeyEvent(false, kc, false, game) end
			elseif t == "click" then
				local btn = (ev.button == "right") and 1 or 0
				VirtualInputManager:SendMouseButtonEvent(ev.x or 0, ev.y or 0, btn, true, game, 1)
				task.wait(0.05)
				VirtualInputManager:SendMouseButtonEvent(ev.x or 0, ev.y or 0, btn, false, game, 1)
			elseif t == "mouseMove" then
				VirtualInputManager:SendMouseMoveEvent(ev.x or 0, ev.y or 0, game)
			elseif t == "wait" then
				task.wait(ev.seconds or 0.5)
			end
			table.insert(sent, t)
		end
		return { ok = true, sent = sent }
	end)
end
