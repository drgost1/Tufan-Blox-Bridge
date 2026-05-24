--!nocheck
-- Long-poll loop. POSTs /ready on start, then repeatedly GET /poll, dispatches
-- the returned command to a handler, and POSTs the result to /response.

local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Config)

local Poll = {}
Poll.__index = Poll

function Poll.new(dispatch, ctx, hooks)
	return setmetatable({
		dispatch = dispatch,
		ctx = ctx,
		hooks = hooks or {},
		running = false,
		connected = false,
	}, Poll)
end

function Poll:_setConnected(state)
	if self.connected ~= state then
		self.connected = state
		if self.hooks.onStatus then self.hooks.onStatus(state) end
	end
end

function Poll:_post(path, payload)
	return HttpService:RequestAsync({
		Url = Config.serverUrl .. path,
		Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body = HttpService:JSONEncode(payload),
	})
end

function Poll:_ready()
	local ok = pcall(function()
		self:_post("/ready", {
			sessionId = self.ctx.sessionId,
			placeName = game.Name,
			placeId = game.PlaceId,
		})
	end)
	self:_setConnected(ok)
	return ok
end

function Poll:_handle(cmd)
	local handler = self.dispatch[cmd.op]
	local ok, result
	if not handler then
		ok, result = false, "unknown op: " .. tostring(cmd.op)
	else
		ok, result = pcall(handler, cmd.args or {})
	end

	if self.hooks.onActivity then
		self.hooks.onActivity(string.format("%s %s", ok and "✓" or "✗", cmd.op))
	end

	pcall(function()
		self:_post("/response", {
			id = cmd.id,
			ok = ok,
			result = ok and result or nil,
			error = (not ok) and tostring(result) or nil,
		})
	end)
end

function Poll:_loop()
	while self.running do
		local ok, response = pcall(function()
			return HttpService:RequestAsync({
				Url = Config.serverUrl .. "/poll?session=" .. self.ctx.sessionId,
				Method = "GET",
			})
		end)

		if not ok then
			-- server unreachable
			self:_setConnected(false)
			task.wait(Config.retryDelaySeconds)
		elseif response.StatusCode == 200 then
			self:_setConnected(true)
			local decoded = nil
			pcall(function() decoded = HttpService:JSONDecode(response.Body) end)
			if decoded and decoded.op then
				task.spawn(function() self:_handle(decoded) end)
			end
		elseif response.StatusCode == 204 then
			self:_setConnected(true) -- long-poll timeout, just re-poll
		else
			self:_setConnected(false)
			task.wait(Config.retryDelaySeconds)
		end
	end
end

function Poll:start()
	if self.running then return end
	self.running = true
	task.spawn(function()
		-- keep retrying /ready until the server answers
		while self.running and not self:_ready() do
			task.wait(Config.retryDelaySeconds)
		end
		self:_loop()
	end)
end

function Poll:stop()
	self.running = false
end

function Poll:isConnected()
	return self.connected
end

return Poll
