--!nocheck
-- ActivityFeed — ring buffer (last 200 events) of Studio activity inferred from
-- LogService.MessageOut. Argon and boshyxd MCP both log their actions; we tag by
-- prefix.
--
-- Categories:
--   "argon"   — anything from Argon's logger (prefix "[Argon]" or starts with "Argon")
--   "mcp"     — anything from boshyxd's MCP plugin logger
--   "error"   — MessageError/MessageWarning regardless of source
--   "system"  — Tufan-Blox-Bridge's own logs
--   "other"   — everything else
--
-- Phase B-source upgrade path: replace LogService inference with direct hooks
-- into vendored Argon Watcher and MCP handlers for semantic events.

local LogService = game:GetService("LogService")

local MAX_EVENTS = 200

local ActivityFeed = {}
ActivityFeed.__index = ActivityFeed

export type Category = "argon" | "mcp" | "error" | "system" | "other"
export type Event = {
	timestamp: number,
	category: Category,
	severity: "info" | "warn" | "error",
	text: string,
}

function ActivityFeed.new()
	local self = setmetatable({
		events = {},
		listeners = {},
		_conn = nil,
	}, ActivityFeed)
	return self
end

local function categorize(message: string): Category
	-- Cheap prefix sniff. Argon's Log.luau prepends "[Argon]" by default.
	local lower = string.lower(message)
	if string.find(lower, "%[argon%]") or string.find(lower, "^argon") then
		return "argon"
	end
	if string.find(lower, "%[mcp") or string.find(lower, "mcp%s") or string.find(lower, "robloxstudio%-mcp") then
		return "mcp"
	end
	if string.find(lower, "%[tufanbloxbridge%]") or string.find(lower, "tufan%-blox%-bridge") then
		return "system"
	end
	return "other"
end

local function severityOf(messageType: Enum.MessageType): "info" | "warn" | "error"
	if messageType == Enum.MessageType.MessageError then
		return "error"
	elseif messageType == Enum.MessageType.MessageWarning then
		return "warn"
	end
	return "info"
end

function ActivityFeed:push(category: Category, severity: "info" | "warn" | "error", text: string)
	local event: Event = {
		timestamp = os.time(),
		category = category,
		severity = severity,
		text = text,
	}
	table.insert(self.events, event)
	if #self.events > MAX_EVENTS then
		table.remove(self.events, 1)
	end
	for _, listener in ipairs(self.listeners) do
		local ok, err = pcall(listener, event)
		if not ok then warn("[TufanBloxBridge.ActivityFeed] listener error: " .. tostring(err)) end
	end
end

function ActivityFeed:onPush(fn)
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

function ActivityFeed:snapshot(): { Event }
	local copy = {}
	for i, e in ipairs(self.events) do copy[i] = e end
	return copy
end

function ActivityFeed:filter(category: Category?): { Event }
	if not category then return self:snapshot() end
	local out = {}
	for _, e in ipairs(self.events) do
		if e.category == category then table.insert(out, e) end
	end
	return out
end

function ActivityFeed:start()
	if self._conn then return end
	self._conn = LogService.MessageOut:Connect(function(message, messageType)
		local severity = severityOf(messageType)
		local category: Category
		if severity == "error" or severity == "warn" then
			category = "error"
		else
			category = categorize(message)
		end
		-- Skip self-logged system messages to avoid feedback loop visualization noise
		if category == "system" and severity == "info" then return end
		self:push(category, severity, message)
	end)
end

function ActivityFeed:stop()
	if self._conn then
		self._conn:Disconnect()
		self._conn = nil
	end
end

return ActivityFeed
