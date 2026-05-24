--!nocheck
-- Watches Studio for ALL script-affecting actions and syncs them to local files:
--   * edit source            -> POST /studio-change   (fast, per-keystroke debounced)
--   * add / paste / duplicate -> reconcile -> /studio-sync (file created)
--   * delete (script or a model/folder of scripts) -> reconcile -> /studio-sync (files removed)
--   * rename / reparent (script or container) -> reconcile -> /studio-sync (move = remove old + write new)
--
-- The reconcile is the workhorse: it diffs the FULL set of script paths against
-- what the server last mirrored and sends the delta, so it converges no matter
-- which Studio action happened. Signals (DescendantAdded/Removing, per-script
-- Name/Ancestry) trigger it promptly; a periodic sweep is the safety net for
-- exotic cases (e.g. renaming a Folder that holds scripts, which fires no signal
-- on the scripts themselves).

local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Parent.Net.Config)
local Serialize = require(script.Parent.Parent.Serialize.Instance)

local ScriptWatcher = {}
ScriptWatcher.__index = ScriptWatcher

local DEBOUNCE = 0.3 -- source-edit coalesce
local RECONCILE_DEBOUNCE = 0.25 -- coalesce a burst of structural events
local RECONCILE_INTERVAL = 4 -- periodic safety-net sweep (seconds)

function ScriptWatcher.new(sessionId, activity)
	return setmetatable({
		sessionId = sessionId,
		activity = activity,
		scriptConns = {}, -- [scriptInst] = { RBXScriptConnection, ... }
		globalConns = {}, -- DescendantAdded / DescendantRemoving
		pendingTimers = {}, -- [scriptInst] = thread (source debounce)
		suppressUntil = {}, -- [studioPath] = os.clock() guard for server-originated edits
		known = {}, -- [studioPath] = true  (what the server currently mirrors)
		reconcileTimer = nil,
		started = false,
	}, ScriptWatcher)
end

-- Called by Apply when a server-originated change lands, so we don't echo it back.
function ScriptWatcher:suppress(studioPath: string)
	self.suppressUntil[studioPath] = os.clock() + 1.0
end

-- ---- source edit (fast path) -------------------------------------------------

function ScriptWatcher:_send(scriptInst)
	local studioPath = Serialize.uniquePath(scriptInst)
	if self.suppressUntil[studioPath] and os.clock() < self.suppressUntil[studioPath] then
		return
	end
	local body = HttpService:JSONEncode({
		sessionId = self.sessionId,
		studioPath = studioPath,
		source = scriptInst.Source,
		className = scriptInst.ClassName,
	})
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

-- ---- reconcile (structural: add/delete/rename/reparent) ----------------------

-- Snapshot every script's current unique path -> instance.
function ScriptWatcher:_collect()
	local map = {}
	for _, d in ipairs(game:GetDescendants()) do
		if d:IsA("LuaSourceContainer") then
			map[Serialize.uniquePath(d)] = d
		end
	end
	return map
end

function ScriptWatcher:_scheduleReconcile()
	if self.reconcileTimer then
		task.cancel(self.reconcileTimer)
	end
	self.reconcileTimer = task.delay(RECONCILE_DEBOUNCE, function()
		self.reconcileTimer = nil
		self:_reconcile()
	end)
end

function ScriptWatcher:_reconcile()
	if not self.started then
		return
	end
	local current = self:_collect()

	-- safety valve: never treat a totally-empty read as "every script was
	-- deleted". That's almost always a transient walk during a big operation,
	-- not reality — acting on it could wipe the whole local mirror.
	if next(current) == nil and next(self.known) ~= nil then
		return
	end

	local removes, upserts = {}, {}
	-- removed: server has it, Studio no longer does
	for path in pairs(self.known) do
		if not current[path] then
			table.insert(removes, { studioPath = path })
		end
	end
	-- added: Studio has it, server doesn't (covers new/paste/duplicate and the
	-- "new path" half of a rename/reparent move)
	for path, inst in pairs(current) do
		if not self.known[path] then
			table.insert(upserts, {
				studioPath = path,
				source = inst.Source,
				className = inst.ClassName,
			})
		end
		self:_watch(inst) -- make sure every current script is watched for edits
	end

	-- adopt the new set as the known mirror state
	self.known = {}
	for path in pairs(current) do
		self.known[path] = true
	end

	-- prune watches for scripts that no longer exist (a deleted container's
	-- children may not each fire DescendantRemoving, so clean up here)
	local live = {}
	for _, inst in pairs(current) do
		live[inst] = true
	end
	for inst in pairs(self.scriptConns) do
		if not live[inst] then
			self:_unwatch(inst)
		end
	end

	if #removes == 0 and #upserts == 0 then
		return
	end

	local body = HttpService:JSONEncode({
		sessionId = self.sessionId,
		removes = removes,
		upserts = upserts,
	})
	local ok = pcall(function()
		HttpService:RequestAsync({
			Url = Config.serverUrl .. "/studio-sync",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = body,
		})
	end)
	if ok and self.activity then
		self.activity(("studio→file: sync (%d add, %d del)"):format(#upserts, #removes))
	end
end

-- ---- per-script watching -----------------------------------------------------

function ScriptWatcher:_watch(scriptInst)
	if self.scriptConns[scriptInst] then
		return
	end
	local conns = {}

	-- source edits -> fast debounced upsert
	table.insert(
		conns,
		scriptInst:GetPropertyChangedSignal("Source"):Connect(function()
			local existing = self.pendingTimers[scriptInst]
			if existing then
				task.cancel(existing)
			end
			self.pendingTimers[scriptInst] = task.delay(DEBOUNCE, function()
				self.pendingTimers[scriptInst] = nil
				if scriptInst.Parent then
					self:_send(scriptInst)
				end
			end)
		end)
	)

	-- rename or reparent of THIS script -> path changed -> reconcile (move)
	table.insert(conns, scriptInst:GetPropertyChangedSignal("Name"):Connect(function()
		self:_scheduleReconcile()
	end))
	table.insert(conns, scriptInst.AncestryChanged:Connect(function()
		self:_scheduleReconcile()
	end))

	self.scriptConns[scriptInst] = conns
end

function ScriptWatcher:_unwatch(scriptInst)
	local conns = self.scriptConns[scriptInst]
	if conns then
		for _, c in ipairs(conns) do
			c:Disconnect()
		end
		self.scriptConns[scriptInst] = nil
	end
	local t = self.pendingTimers[scriptInst]
	if t then
		task.cancel(t)
		self.pendingTimers[scriptInst] = nil
	end
end

-- ---- lifecycle ---------------------------------------------------------------

function ScriptWatcher:start()
	if self.started then
		return
	end
	self.started = true

	-- seed known + watch every existing script (do NOT send — pull already wrote them)
	local current = self:_collect()
	for path, inst in pairs(current) do
		self.known[path] = true
		self:_watch(inst)
	end

	table.insert(
		self.globalConns,
		game.DescendantAdded:Connect(function(d)
			if d:IsA("LuaSourceContainer") then
				self:_watch(d)
			end
			-- a pasted/dragged-in subtree may carry scripts at any depth; reconcile
			-- re-walks the tree so they all get picked up regardless
			self:_scheduleReconcile()
		end)
	)
	table.insert(
		self.globalConns,
		game.DescendantRemoving:Connect(function(d)
			if d:IsA("LuaSourceContainer") then
				self:_unwatch(d)
			end
			-- d (and any scripts under it) are about to leave the tree; the
			-- debounced reconcile runs after they're gone and emits the removes
			self:_scheduleReconcile()
		end)
	)

	-- periodic safety net: catches path changes that fire no script-level signal
	-- (e.g. renaming a Folder/Model that contains scripts)
	task.spawn(function()
		while self.started do
			task.wait(RECONCILE_INTERVAL)
			if self.started then
				self:_reconcile()
			end
		end
	end)
end

function ScriptWatcher:stop()
	self.started = false
	if self.reconcileTimer then
		task.cancel(self.reconcileTimer)
		self.reconcileTimer = nil
	end
	for _, c in ipairs(self.globalConns) do
		if typeof(c) == "RBXScriptConnection" then
			c:Disconnect()
		end
	end
	self.globalConns = {}
	for inst in pairs(self.scriptConns) do
		self:_unwatch(inst)
	end
	self.scriptConns = {}
end

return ScriptWatcher
