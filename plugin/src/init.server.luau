--!nocheck
-- Tufan-Blox-Bridge plugin — boots the poll loop, handler dispatch, script
-- watcher, and UI. Talks to the Tufan-Blox-Bridge MCP server on 127.0.0.1:58741.

if not plugin then
	warn("[TufanBloxBridge] not running as a plugin")
	return
end

local HttpService = game:GetService("HttpService")

local buildDispatch = require(script.Handlers)
local ScriptWatcher = require(script.Sync.ScriptWatcher)
local Poll = require(script.Net.Poll)
local UI = require(script.UI)
local Settings = require(script.Settings)

local ctx = { sessionId = HttpService:GenerateGUID(false) }
ctx.settings = Settings.new(plugin) -- persisted; sent to the server on /ready + on toggle

local ui = UI.start(plugin, ctx)
ui.pushActivity("plugin loaded — connecting to server")

local watcher = ScriptWatcher.new(ctx.sessionId, function(msg) ui.pushActivity(msg) end)

-- Apply (file->Studio) calls this so the watcher doesn't echo server writes back.
ctx.suppress = function(path) watcher:suppress(path) end

local dispatch = buildDispatch(ctx)

local poll = Poll.new(dispatch, ctx, {
	onStatus = function(connected) ui.setStatus(connected, ctx.sessionId) end,
	onActivity = function(msg) ui.pushActivity(msg) end,
})

poll:start()
watcher:start()

plugin.Unloading:Connect(function()
	poll:stop()
	watcher:stop()
end)

print("[TufanBloxBridge] plugin v0.4.0 started (session " .. string.sub(ctx.sessionId, 1, 8) .. ")")
