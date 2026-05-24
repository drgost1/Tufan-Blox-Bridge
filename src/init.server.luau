--!nocheck
-- Tufan-Blox-Bridge — unified Studio plugin combining Argon two-way sync and
-- boshyxd MCP AI tools under a single brand. Built by Tufan Studio.
--
-- Phase A: vendored Argon.rbxm and MCPPlugin.rbxmx boot themselves from
-- src/vendor/ — their Scripts run as descendants of this plugin.
-- Phase B: this file additionally starts the Coordinator (HealthCheck,
-- ActivityFeed) and the unified UI (toolbar + tabbed widget).

local RunService = game:GetService("RunService")

if not plugin then
	warn("[TufanBloxBridge] not running as a plugin — aborting")
	return
end

local VERSION = "0.2.0-phase-b"
print(string.format("[TufanBloxBridge] v%s loading (edit mode: %s)", VERSION, tostring(not RunService:IsRunning())))

local Coordinator = require(script.Coordinator)
local UI = require(script.UI)

local coordinator = Coordinator.new()
coordinator:start(plugin)

UI.start(plugin, coordinator)

plugin.Unloading:Connect(function()
	coordinator:stop()
end)

print(string.format("[TufanBloxBridge] v%s loaded", VERSION))
