--!nocheck
-- Mirrors NON-script instance trees to the local mirror as binary .rbxm files,
-- next to the script files ScriptWatcher writes. The unit of storage is every
-- direct child of a tracked service (StarterGui.MineGui, ReplicatedStorage.Mining,
-- ServerStorage.TreePack, ...): one file each, holding the whole subtree
-- (scripts inside included), serialized with SerializationService so a restore
-- brings back exactly what was there.
--
-- Change detection, cheapest first:
--   * structure: DescendantAdded / DescendantRemoving under a tracked service
--   * properties under StarterGui: a Changed connection per descendant (UI is
--     where most hand edits happen)
--   * undo / redo: every StarterGui unit plus the selection's units are checked
--   * everything else: a periodic sweep, plus a sweep shortly after AI commands
-- A check serializes the unit and compares a hash of it with the hash of what
-- was last uploaded, so nothing is sent unless the bytes really changed (and the
-- plugin keeps 32 bytes per unit in memory instead of a copy of every unit).
-- Flushes are debounced and batched into one POST, which keeps a big GUI rebuild to a couple of requests
-- (the plugin's HTTP budget is about 500 a minute).
--
-- The server keeps a frozen copy in .history/ whenever a unit is removed, loses
-- descendants, or is overwritten after a quiet spell; restore_from_mirror reads
-- from there.

local HttpService = game:GetService("HttpService")
local SerializationService = game:GetService("SerializationService")
local EncodingService = game:GetService("EncodingService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")
local Config = require(script.Parent.Parent.Net.Config)

local InstanceWatcher = {}
InstanceWatcher.__index = InstanceWatcher

local TRACKED_SERVICES = { "StarterGui", "ReplicatedStorage", "ServerStorage", "StarterPack", "Lighting" }
-- Per-instance Changed connections only here (property edits elsewhere are
-- caught by the sweep).
local FINE_GRAINED = { StarterGui = true }
-- Never mirrored: the bridge's own in-place snapshot store.
local SKIP_NAMES = { _TufanSnapshots = true }

local FLUSH_DEBOUNCE = 2 -- seconds of quiet before dirty units are checked
local SWEEP_INTERVAL = 90 -- full check of every unit
local COMMAND_SWEEP_GAP = 20 -- at most one extra sweep this often after AI commands

-- Commands that never change the place. They don't trigger a sweep, so a burst
-- of reads (get_tree, grep, scans) costs no serialization at all.
local READ_ONLY_OPS = {
	describe = true, getAttributes = true, getChildren = true, getDescendants = true,
	getOutputLog = true, getProperties = true, getScriptSource = true, getSelection = true,
	getServices = true, getTagged = true, getTags = true, getTree = true, grepScripts = true,
	isRunning = true, listSnapshots = true, ping = true, projectHealth = true, pullAll = true,
	scanBackdoors = true, scanPerf = true, scanResponsive = true, searchByProperty = true,
	searchMaterials = true, searchObjects = true, setSelection = true,
}
local RETRY_DELAY = 8 -- after a failed upload (server not ready, HTTP budget)
-- Units that take longer than this to serialize are left out of the periodic
-- sweep and only checked every HEAVY_SWEEP_EVERY sweeps, unless an edit marked
-- them dirty. A 40,000-instance backup folder costs a third of a second per check.
local HEAVY_UNIT_SECONDS = 0.1
local HEAVY_SWEEP_EVERY = 4
local MAX_BATCH_BYTES = 4 * 1024 * 1024 -- raw bytes per POST (base64 adds a third)
local MAX_UNIT_BYTES = 40 * 1024 * 1024 -- anything bigger is skipped with a warning

local function unitSegment(inst: Instance): string
	-- same " (N)" convention as Serialize.uniquePath, so keys match tool paths
	local parent = inst.Parent
	local count, idx = 0, 0
	for _, c in ipairs(parent:GetChildren()) do
		if c.Name == inst.Name then
			count += 1
			if c == inst then
				idx = count
			end
		end
	end
	if count > 1 and idx > 1 then
		return inst.Name .. " (" .. idx .. ")"
	end
	return inst.Name
end

function InstanceWatcher.new(sessionId, activity)
	local roots = {}
	for _, name in ipairs(TRACKED_SERVICES) do
		local ok, svc = pcall(game.GetService, game, name)
		if ok and svc then
			roots[svc] = name
		end
	end
	return setmetatable({
		sessionId = sessionId,
		activity = activity,
		roots = roots, -- [service] = serviceName
		cache = {}, -- [key] = hash of the last uploaded bytes (or "__too_big")
		cost = {}, -- [key] = seconds the last serialize of this unit took
		periodicSweeps = 0,
		known = {}, -- [key] = true   (what the server holds)
		dirty = {}, -- [unitInst] = "edit" | "child-removed"
		changeConns = {}, -- [inst] = RBXScriptConnection (fine-grained services)
		globalConns = {},
		flushTimer = nil,
		flushing = false,
		flushAgain = false,
		sweepAll = false,
		manifestSent = false,
		lastCommandSweep = 0,
		started = false,
	}, InstanceWatcher)
end

-- ---- unit lookup ---------------------------------------------------------------

-- The tracked unit an instance belongs to (the ancestor that is a direct child
-- of a tracked service), or nil.
function InstanceWatcher:_unitOf(inst: Instance): Instance?
	local cur = inst
	while cur do
		local parent = cur.Parent
		if parent == nil then
			return nil
		end
		if self.roots[parent] then
			if SKIP_NAMES[cur.Name] then
				return nil
			end
			return cur
		end
		cur = parent
	end
	return nil
end

-- key -> { inst, service, name }
function InstanceWatcher:_listUnits()
	local units = {}
	for svc, svcName in pairs(self.roots) do
		for _, child in ipairs(svc:GetChildren()) do
			if not SKIP_NAMES[child.Name] then
				local name = unitSegment(child)
				units[svcName .. "." .. name] = { inst = child, service = svcName, name = name }
			end
		end
	end
	return units
end

-- ---- dirty marking --------------------------------------------------------------

function InstanceWatcher:_markDirty(unit: Instance?, reason: string?)
	if not unit then
		return
	end
	-- "child-removed" wins over "edit": it tells the server to keep a frozen copy
	if reason == "child-removed" or not self.dirty[unit] then
		self.dirty[unit] = reason or "edit"
	end
	self:_scheduleFlush(FLUSH_DEBOUNCE)
end

function InstanceWatcher:_markSelection()
	for _, inst in ipairs(Selection:Get()) do
		self:_markDirty(self:_unitOf(inst), "edit")
	end
end

function InstanceWatcher:_markFineGrainedUnits()
	for svc, svcName in pairs(self.roots) do
		if FINE_GRAINED[svcName] then
			for _, child in ipairs(svc:GetChildren()) do
				if not SKIP_NAMES[child.Name] then
					self:_markDirty(child, "edit")
				end
			end
		end
	end
end

function InstanceWatcher:_scheduleFlush(delaySeconds)
	if self.flushTimer then
		task.cancel(self.flushTimer)
	end
	self.flushTimer = task.delay(delaySeconds, function()
		self.flushTimer = nil
		self:_flush()
	end)
end

-- Called by the poll loop after every AI command: AI edits outside StarterGui
-- fire no Changed we listen to, so run a sweep soon (rate-limited). Read-only
-- commands, and run_luau calls the server marks read-only, are skipped.
function InstanceWatcher:noteCommand(op: string?, args: { [string]: any }?)
	if not self.started then
		return
	end
	if op and READ_ONLY_OPS[op] then
		return
	end
	if op == "runLuau" and type(args) == "table" and args.readOnly == true then
		return
	end
	local now = os.clock()
	if now - self.lastCommandSweep < COMMAND_SWEEP_GAP then
		return
	end
	self.lastCommandSweep = now
	task.delay(5, function()
		if self.started then
			self.sweepAll = self.sweepAll or "command"
			self:_scheduleFlush(0)
		end
	end)
end

-- ---- serialize + upload -------------------------------------------------------------

local function serialize(inst: Instance): (buffer?, string?)
	local ok, result = pcall(function()
		return SerializationService:SerializeInstancesAsync({ inst })
	end)
	if not ok then
		return nil, tostring(result)
	end
	return result, nil
end

-- 32-byte digest of a serialized unit; about 1 ms per MB.
local function digest(data: buffer): string
	return buffer.tostring(EncodingService:ComputeBufferHash(data, Enum.HashAlgorithm.Blake3))
end

local function base64(data: buffer): string
	return buffer.tostring(EncodingService:Base64Encode(data))
end

function InstanceWatcher:_post(payload): (boolean, any)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = Config.serverUrl .. "/studio-instances",
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode(payload),
		})
	end)
	if not ok or not response.Success then
		return false, nil
	end
	local okDecode, body = pcall(HttpService.JSONDecode, HttpService, response.Body)
	if not okDecode or type(body) ~= "table" or not body.ok then
		return false, body
	end
	-- a new server process or mirror folder: forget what we think it holds and
	-- upload everything again on the next flush
	if body.epoch then
		if self.epoch and body.epoch ~= self.epoch then
			self.cache = {}
			self.known = {}
			self.manifestSent = false
			self.epoch = body.epoch
			self.sweepAll = true
			self:_scheduleFlush(1)
			return true, body, true
		end
		self.epoch = body.epoch
	end
	return true, body
end

function InstanceWatcher:_flush()
	if not self.started then
		return
	end
	if self.flushing then
		self.flushAgain = true
		return
	end
	self.flushing = true
	repeat
		self.flushAgain = false
		local ok, err = pcall(self._flushOnce, self)
		if not ok then
			warn("[TufanBloxBridge] instance mirror flush failed: " .. tostring(err))
		end
	until not self.flushAgain or not self.started
	self.flushing = false
end

function InstanceWatcher:_flushOnce()
	local sweep = self.sweepAll
	self.sweepAll = false
	-- periodic sweeps skip heavy units except every HEAVY_SWEEP_EVERY-th one
	local skipHeavy = false
	if sweep == "periodic" then
		self.periodicSweeps += 1
		skipHeavy = self.periodicSweeps % HEAVY_SWEEP_EVERY ~= 0
	end
	local dirty = self.dirty
	self.dirty = {}

	local units = self:_listUnits()

	-- safety valve: an empty read of every service is a transient glitch, not
	-- "everything was deleted"
	if next(units) == nil and next(self.known) ~= nil then
		return
	end

	local removes = {}
	for key in pairs(self.known) do
		if not units[key] then
			table.insert(removes, { studioPath = key })
		end
	end

	-- serialize what may have changed; yield between units so a sweep never
	-- freezes Studio
	local upserts = {}
	local pendingCache = {}
	for key, u in pairs(units) do
		-- a mark made while this flush was already walking (a sweep yields per
		-- unit) is taken now, so its reason ("child-removed") isn't lost
		local reason = dirty[u.inst]
		local late = self.dirty[u.inst]
		if late then
			self.dirty[u.inst] = nil
			if late == "child-removed" or not reason then
				reason = late
			end
		end
		local heavySkip = skipHeavy and not reason and (self.cost[key] or 0) > HEAVY_UNIT_SECONDS
		if (sweep or reason or self.cache[key] == nil) and not heavySkip then
			local started = os.clock()
			local data, serr = serialize(u.inst)
			self.cost[key] = os.clock() - started
			if not data then
				warn(("[TufanBloxBridge] couldn't serialize %s for the mirror: %s"):format(key, tostring(serr)))
			elseif buffer.len(data) > MAX_UNIT_BYTES then
				if self.cache[key] ~= "__too_big" then
					warn(("[TufanBloxBridge] %s is %d MB, too big for the instance mirror; skipped"):format(key, buffer.len(data) // (1024 * 1024)))
				end
				pendingCache[key] = "__too_big"
			else
				local hash = digest(data)
				if hash ~= self.cache[key] then
					table.insert(upserts, {
						studioPath = key,
						service = u.service,
						name = u.name,
						className = u.inst.ClassName,
						reason = reason or "edit",
						raw = data,
						hash = hash,
					})
				end
			end
			task.wait()
		end
	end
	for key, value in pairs(pendingCache) do
		self.cache[key] = value
	end

	local needManifest = not self.manifestSent
	if #removes == 0 and #upserts == 0 and not needManifest then
		-- nothing to send; on a sweep, still ask the server for its epoch so a
		-- restarted server gets a full re-upload (one tiny request per sweep)
		if sweep then
			self:_post({ sessionId = self.sessionId, upserts = {}, removes = {} })
		end
		return
	end

	-- send in batches of at most MAX_BATCH_BYTES raw
	local failed = false
	local batch, batchBytes = {}, 0
	local function send(isLast)
		local items = {}
		for _, item in ipairs(batch) do
			table.insert(items, {
				studioPath = item.studioPath,
				service = item.service,
				name = item.name,
				className = item.className,
				reason = item.reason,
				data = base64(item.raw),
			})
		end
		local payload = { sessionId = self.sessionId, upserts = items, removes = {} }
		if isLast then
			payload.removes = removes
			if needManifest then
				local manifest = {}
				for key in pairs(units) do
					table.insert(manifest, key)
				end
				payload.manifest = manifest
				payload.services = TRACKED_SERVICES
			end
		end
		local ok, _, reset = self:_post(payload)
		if reset then
			-- the server changed under us; the reset already queued a full flush
			batch, batchBytes = {}, 0
			return
		end
		if ok then
			for _, item in ipairs(batch) do
				self.cache[item.studioPath] = item.hash
				self.known[item.studioPath] = true
			end
			if isLast then
				for _, r in ipairs(removes) do
					self.known[r.studioPath] = nil
					self.cache[r.studioPath] = nil
				end
				if needManifest then
					self.manifestSent = true
				end
			end
		else
			failed = true
			-- put them back so the retry re-checks them
			for _, item in ipairs(batch) do
				local u = units[item.studioPath]
				if u then
					self.dirty[u.inst] = item.reason
				end
			end
		end
		batch, batchBytes = {}, 0
	end

	for _, item in ipairs(upserts) do
		local size = buffer.len(item.raw)
		if batchBytes > 0 and batchBytes + size > MAX_BATCH_BYTES then
			send(false)
		end
		table.insert(batch, item)
		batchBytes += size
	end
	send(true)

	-- units the server already holds become known without re-upload only after a
	-- successful manifest; until then every unit counts as new
	if failed then
		self:_scheduleFlush(RETRY_DELAY)
		return
	end
	if self.activity and (#upserts > 0 or #removes > 0) then
		self.activity(("studio→file: instances (%d saved, %d removed)"):format(#upserts, #removes))
	end
end

-- ---- watching ---------------------------------------------------------------------

function InstanceWatcher:_watchChanged(inst: Instance)
	if self.changeConns[inst] then
		return
	end
	local ok, conn = pcall(function()
		return inst.Changed:Connect(function()
			self:_markDirty(self:_unitOf(inst), "edit")
		end)
	end)
	if ok then
		self.changeConns[inst] = conn
	end
end

function InstanceWatcher:_unwatchChanged(inst: Instance)
	local conn = self.changeConns[inst]
	if conn then
		conn:Disconnect()
		self.changeConns[inst] = nil
	end
end

function InstanceWatcher:start()
	if self.started then
		return
	end
	self.started = true

	for svc, svcName in pairs(self.roots) do
		local fine = FINE_GRAINED[svcName]
		if fine then
			for _, d in ipairs(svc:GetDescendants()) do
				self:_watchChanged(d)
			end
		end
		table.insert(self.globalConns, svc.DescendantAdded:Connect(function(d)
			if fine then
				self:_watchChanged(d)
			end
			self:_markDirty(self:_unitOf(d), "edit")
		end))
		table.insert(self.globalConns, svc.DescendantRemoving:Connect(function(d)
			if fine then
				-- each removed descendant fires its own event, so unwatch just this one;
				-- walking d's subtree here made deleting a big GUI O(n^2)
				self:_unwatchChanged(d)
			end
			local unit = self:_unitOf(d)
			if unit == d then
				-- the whole unit is leaving; the flush sees it missing and removes it
				self:_scheduleFlush(FLUSH_DEBOUNCE)
			else
				self:_markDirty(unit, "child-removed")
			end
		end))
	end

	local function onHistory()
		self:_markFineGrainedUnits()
		self:_markSelection()
	end
	table.insert(self.globalConns, ChangeHistoryService.OnUndo:Connect(onHistory))
	table.insert(self.globalConns, ChangeHistoryService.OnRedo:Connect(onHistory))
	pcall(function()
		table.insert(self.globalConns, ChangeHistoryService.OnRecordingFinished:Connect(function()
			self:_markSelection()
		end))
	end)

	-- first flush uploads everything that differs and sends the manifest
	self:_scheduleFlush(3)

	task.spawn(function()
		while self.started do
			task.wait(SWEEP_INTERVAL)
			if self.started then
				self.sweepAll = "periodic"
				self:_flush()
			end
		end
	end)
end

function InstanceWatcher:stop()
	self.started = false
	if self.flushTimer then
		task.cancel(self.flushTimer)
		self.flushTimer = nil
	end
	for _, c in ipairs(self.globalConns) do
		if typeof(c) == "RBXScriptConnection" then
			c:Disconnect()
		end
	end
	self.globalConns = {}
	for inst in pairs(self.changeConns) do
		self:_unwatchChanged(inst)
	end
end

return InstanceWatcher
