--!nocheck
-- Watches every script's Source for Studio-side edits and POSTs {studioPath,
-- source} to the server. The server maps the studio path to a file (or ignores
-- it if unmapped). A short debounce coalesces rapid keystrokes; a guard
-- suppresses echoes from server-originated file->Studio writes.

local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Parent.Net.Config)

local ScriptWatcher = {}
ScriptWatcher.__index = ScriptWatcher

local DEBOUNCE = 0.3

function ScriptWatcher.new(sessionId, activity)
	return setmetatable({
		sessionId = sessionId,
		activity = activity,
		connections = {},
		pendingTimers = {},
		-- studioPath -> os.clock() when the server last pushed this script in
		suppressUntil = {},
		started = false,
	}, ScriptWatcher)
end

-- Called by Apply when a server-originated change lands, so we don't echo it back.
function ScriptWatcher:suppress(studioPath: string)
	self.suppressUntil[studioPath] = os.clock() + 1.0
end

function ScriptWatcher:_send(scriptInst)
	local studioPath = scriptInst:GetFullName()
	if self.suppressUntil[studioPath] and os.clock() < self.suppressUntil[studioPath] then
		return
	end
	local body = HttpService:JSONEncode({ sessionId = self.sessionId, studioPath = studioPath, source = scriptInst.Source })
	local ok = pcall(function()
		HttpService:RequestAsync({
			Url = Config.serverUrl .. "/studio-change",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = body,
		})
	end)
	if ok and self.activity then
		self.activity("studio→file: " .. studioPath)
	end
end

function ScriptWatcher:_watch(scriptInst)
	if self.connections[scriptInst] then return end
	self.connections[scriptInst] = scriptInst:GetPropertyChangedSignal("Source"):Connect(function()
		local existing = self.pendingTimers[scriptInst]
		if existing then task.cancel(existing) end
		self.pendingTimers[scriptInst] = task.delay(DEBOUNCE, function()
			self.pendingTimers[scriptInst] = nil
			if scriptInst.Parent then
				self:_send(scriptInst)
			end
		end)
	end)
end

function ScriptWatcher:start()
	if self.started then return end
	self.started = true

	for _, d in ipairs(game:GetDescendants()) do
		if d:IsA("LuaSourceContainer") then
			self:_watch(d)
		end
	end
	table.insert(self.connections, game.DescendantAdded:Connect(function(d)
		if d:IsA("LuaSourceContainer") then
			self:_watch(d)
		end
	end))
end

function ScriptWatcher:stop()
	for _, c in pairs(self.connections) do
		if typeof(c) == "RBXScriptConnection" then c:Disconnect() end
	end
	self.connections = {}
end

return ScriptWatcher
