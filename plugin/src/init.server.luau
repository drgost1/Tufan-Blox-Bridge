--!nocheck
-- Tufan-Blox-Bridge plugin — boots the poll loop, handler dispatch, script
-- watcher, and UI. Talks to the Tufan-Blox-Bridge MCP server on 127.0.0.1:58741.

if not plugin then
	warn("[TufanBloxBridge] not running as a plugin")
	return
end

-- Edit-DataModel guard. When you Play/Play-Here (F5), Studio forks a separate
-- RUNTIME DataModel and spins up a SECOND, throwaway copy of every plugin inside
-- it — terminated the moment you stop. If that runtime copy also /ready'd and
-- served commands, its edits would land in the runtime DM and be DISCARDED on
-- stop (the "works but weak/glitchy during playtest" symptom). We want the
-- opposite: edits made during a playtest must persist. So the runtime copy stays
-- passive — ONLY the persistent edit-context plugin serves commands, and every
-- edit lands in the edit DataModel and survives the playtest (the behavior devs
-- expect, and what makes "build while playtesting" actually stick).
--
-- The edit-context instance keeps running throughout Play, so the MCP stays live
-- during a playtest; its mutations just show up when the next run reads the edit
-- DM. (RunService:Run() "Run mode" never forks a DM, so this never gates it.)
local RunService = game:GetService("RunService")
if not RunService:IsEdit() then
	print("[TufanBloxBridge] runtime DataModel copy — staying passive (edit-context instance serves)")
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

print("[TufanBloxBridge] plugin v0.9.0 started (session " .. string.sub(ctx.sessionId, 1, 8) .. ")")
