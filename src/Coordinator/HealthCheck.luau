--!nocheck
-- HealthCheck — pings Argon CLI (port 34872) and boshyxd MCP server (port 58741)
-- every 5 seconds. Exposes a Signal-like callback that UI tabs subscribe to so
-- the status pill can update without polling.

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local ARGON_URL = "http://127.0.0.1:34872/details"
local MCP_URL = "http://127.0.0.1:58741/poll?instanceId=tufan-bridge-healthcheck"
local INTERVAL = 5

local HealthCheck = {}
HealthCheck.__index = HealthCheck

export type Status = "ok" | "down" | "unknown"

function HealthCheck.new()
	local self = setmetatable({
		argon = "unknown" :: Status,
		mcp = "unknown" :: Status,
		argonLatencyMs = 0,
		mcpLatencyMs = 0,
		listeners = {},
		_running = false,
	}, HealthCheck)
	return self
end

function HealthCheck:onChange(fn)
	table.insert(self.listeners, fn)
	return function()
		for i, listener in ipairs(self.listeners) do
			if listener == fn then
				table.remove(self.listeners, i)
				break
			end
		end
	end
end

function HealthCheck:_emit()
	for _, listener in ipairs(self.listeners) do
		local ok, err = pcall(listener, self.argon, self.mcp, self.argonLatencyMs, self.mcpLatencyMs)
		if not ok then
			warn("[TufanBloxBridge.HealthCheck] listener error: " .. tostring(err))
		end
	end
end

local function probe(url)
	local t0 = os.clock()
	local ok = pcall(function()
		HttpService:RequestAsync({
			Url = url,
			Method = "GET",
		})
	end)
	local elapsedMs = math.floor((os.clock() - t0) * 1000)
	return ok, elapsedMs
end

function HealthCheck:_tick()
	local argonOk, argonMs = probe(ARGON_URL)
	local mcpOk, mcpMs = probe(MCP_URL)

	local newArgon: Status = argonOk and "ok" or "down"
	local newMcp: Status = mcpOk and "ok" or "down"

	local changed = newArgon ~= self.argon or newMcp ~= self.mcp
	self.argon = newArgon
	self.mcp = newMcp
	self.argonLatencyMs = argonMs
	self.mcpLatencyMs = mcpMs

	if changed then
		self:_emit()
	end
end

function HealthCheck:start()
	if self._running then return end
	self._running = true

	task.spawn(function()
		while self._running do
			self:_tick()
			task.wait(INTERVAL)
		end
	end)
end

function HealthCheck:stop()
	self._running = false
end

function HealthCheck:snapshot()
	return {
		argon = self.argon,
		mcp = self.mcp,
		argonLatencyMs = self.argonLatencyMs,
		mcpLatencyMs = self.mcpLatencyMs,
	}
end

return HealthCheck
