--!nocheck
-- EditLock — STUB.
--
-- The original plan was a 500ms mutex between MCP writes and Argon sync-back:
-- when MCP set_script_source fires, Argon's Watcher would skip echoing that
-- Studio change to disk for the lock window.
--
-- BLOCKED in compiled-binary vendoring: we can't intercept Argon's Watcher or
-- MCP's ScriptHandler.setScriptSource without source-level access. Both are
-- baked into the .rbxm files vendored in src/vendor/.
--
-- Practical observation: the race is rarely visible. When MCP writes script X
-- with content C, Argon sees Studio change to C and writes file X = C. Same
-- content. No data loss. The actual conflict (different content from both
-- sides simultaneously) is uncommon in solo dev workflows.
--
-- Upgrade path (deferred to Phase D or a Phase B2 source vendor):
--   1. Install wally, vendor argon-rbx/argon-roblox source
--   2. Patch Watcher.luau to consult :isLocked(path) before sync-back
--   3. Vendor boshyxd source, rbxtsc compile
--   4. Patch ScriptHandlers.setScriptSource to call :beginAIWrite(path)
--
-- For now this module exists so the import path is stable and so the activity
-- feed can still surface "MCP wrote X" / "Argon synced X" events without
-- enforcement.

local EditLock = {}
EditLock.__index = EditLock

function EditLock.new()
	return setmetatable({
		locks = {},
		windowMs = 500,
	}, EditLock)
end

function EditLock:beginAIWrite(_path: string)
	-- TODO: real implementation in Phase D
end

function EditLock:isLocked(_path: string): boolean
	return false
end

return EditLock
