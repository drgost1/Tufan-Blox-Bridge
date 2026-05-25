--!nocheck
-- Persistent plugin settings. Stored via plugin:SetSetting, so they survive
-- Studio restarts ("turn it on once → stays on next session"). Everything
-- defaults to OFF — git/GitHub is strictly opt-in, so a user who doesn't want
-- the repo headache simply never enables it.

local Settings = {}
Settings.__index = Settings

local PREFIX = "TufanBloxBridge_"
local DEFAULTS = { gitEnabled = false, autoCommit = false, autoPush = false }

function Settings.new(plugin)
	local self = setmetatable({ plugin = plugin, cache = {} }, Settings)
	for key, default in pairs(DEFAULTS) do
		local stored = plugin:GetSetting(PREFIX .. key)
		self.cache[key] = (type(stored) == "boolean") and stored or default
	end
	return self
end

function Settings:get(key)
	return self.cache[key]
end

-- Snapshot for sending to the server (on /ready and on change).
function Settings:all()
	return {
		gitEnabled = self.cache.gitEnabled,
		autoCommit = self.cache.autoCommit,
		autoPush = self.cache.autoPush,
	}
end

function Settings:set(key, value)
	value = value and true or false
	self.cache[key] = value
	self.plugin:SetSetting(PREFIX .. key, value) -- persists across sessions
	return value
end

return Settings
