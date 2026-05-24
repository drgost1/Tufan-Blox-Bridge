--!nocheck
-- Coordinator — owns the three sub-systems that glue Argon and MCP together.

local HealthCheck = require(script.HealthCheck)
local ActivityFeed = require(script.ActivityFeed)
local EditLock = require(script.EditLock)

local Coordinator = {}
Coordinator.__index = Coordinator

function Coordinator.new()
	local self = setmetatable({
		healthCheck = HealthCheck.new(),
		activityFeed = ActivityFeed.new(),
		editLock = EditLock.new(),
		_running = false,
	}, Coordinator)
	return self
end

function Coordinator:start(plugin: Plugin)
	if self._running then return end
	self._running = true
	self.plugin = plugin

	self.healthCheck:start()
	self.activityFeed:start()

	-- Bridge health changes into the activity feed so the user sees them inline.
	self.healthCheck:onChange(function(argon, mcp)
		self.activityFeed:push(
			"system",
			"info",
			string.format("[TufanBloxBridge] health: argon=%s mcp=%s", argon, mcp)
		)
	end)

	self.activityFeed:push("system", "info", "[TufanBloxBridge] Coordinator started")
end

function Coordinator:stop()
	if not self._running then return end
	self._running = false
	self.healthCheck:stop()
	self.activityFeed:stop()
end

return Coordinator
