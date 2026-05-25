--!nocheck
-- Long-poll loop. POSTs /ready on start, then repeatedly GET /poll, dispatches
-- the returned command to a handler, and POSTs the result to /response.

local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Config = require(script.Parent.Config)

-- The real published place name (game.Name is the generic "Place1"). Cached.
local placeNameCache = nil
local function getPlaceName(): string
	if placeNameCache then
		return placeNameCache
	end
	local name = game.Name
	if game.PlaceId and game.PlaceId ~= 0 then
		local ok, info = pcall(function()
			return MarketplaceService:GetProductInfo(game.PlaceId)
		end)
		if ok and type(info) == "table" and info.Name and info.Name ~= "" then
			name = info.Name
		end
	end
	placeNameCache = name
	return name
end

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
			placeName = getPlaceName(),
			placeId = game.PlaceId,
			gameId = game.GameId,
			settings = self.ctx.settings and self.ctx.settings:all() or nil, -- gitEnabled/autoCommit/autoPush
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

	-- Always send a response. If the result can't be JSON-encoded (e.g. it
	-- contains an invalid-UTF8 string or NaN), fall back to an error response
	-- so the server never hangs waiting.
	local payload = {
		sessionId = self.ctx.sessionId,
		id = cmd.id,
		ok = ok,
		result = ok and result or nil,
		error = (not ok) and tostring(result) or nil,
	}
	local encodeOk, encoded = pcall(function()
		return HttpService:JSONEncode(payload)
	end)
	if not encodeOk then
		encoded = HttpService:JSONEncode({
			sessionId = self.ctx.sessionId,
			id = cmd.id,
			ok = false,
			error = string.format("result of '%s' is not JSON-serializable", cmd.op),
		})
	end
	pcall(function()
		HttpService:RequestAsync({
			Url = Config.serverUrl .. "/response",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = encoded,
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
		elseif response.StatusCode == 409 then
			-- server restarted / forgot us — re-announce then re-poll
			self:_ready()
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
