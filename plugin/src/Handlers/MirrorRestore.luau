--!nocheck
-- restoreFromMirror: put one instance back from a file the instance mirror (or
-- its .history) holds. The server picks the file and sends it here:
--   kind = "rbxm"   data = base64 .rbxm of a whole unit (e.g. StarterGui.FarmGui),
--                   subPath = the part of the wanted path below that unit
--                   ("" = the unit itself, "Toasts" = StarterGui.FarmGui.Toasts)
--   kind = "script" source + className for a script file from .history
-- If the wanted instance isn't inside the given file, returns { found = false }
-- so the server can try an older copy.
local SerializationService = game:GetService("SerializationService")
local EncodingService = game:GetService("EncodingService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Serialize = require(script.Parent.Parent.Serialize.Instance)

-- Walk `segments` (split on ".") from `root`, joining segments when a name
-- itself contains dots. Returns the found instance and the list of real names
-- walked (with " (N)" disambiguators kept), or nil.
local function walk(root: Instance, path: string)
	if path == "" then
		return root, {}
	end
	local segments = string.split(path, ".")
	local current = root
	local names = {}
	local i = 1
	while i <= #segments do
		local name = segments[i]
		local last = i
		local child = Serialize.findChild(current, name)
		while not child and last < #segments do
			last += 1
			name = name .. "." .. segments[last]
			child = Serialize.findChild(current, name)
		end
		if not child then
			return nil, nil
		end
		table.insert(names, name)
		current = child
		i = last + 1
	end
	return current, names
end

local function walkNames(root: Instance, names)
	local current = root
	for _, name in ipairs(names) do
		local child = Serialize.findChild(current, name)
		if not child then
			return nil, name
		end
		current = child
	end
	return current, nil
end

local function place(restored: Instance, parent: Instance, replace: boolean)
	local existing = parent:FindFirstChild(restored.Name)
	if existing and existing.ClassName == restored.ClassName then
		if not replace then
			restored:Destroy()
			error(("%s already has a %s named '%s'; pass replace=true to overwrite it"):format(
				parent:GetFullName(), existing.ClassName, existing.Name))
		end
	else
		existing = nil
	end
	local recording = ChangeHistoryService:TryBeginRecording("TufanBridge: restore " .. restored.Name)
	if existing then
		existing:Destroy()
	end
	restored.Parent = parent
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return {
		found = true,
		ok = true,
		path = Serialize.uniquePath(restored),
		className = restored.ClassName,
		descendants = #restored:GetDescendants(),
		replaced = existing ~= nil,
	}
end

return function(register)
	register("restoreFromMirror", function(args)
		local replace = args.replace == true

		if args.kind == "script" then
			local segments = string.split(args.studioPath, ".")
			local leaf = table.remove(segments)
			local parentPath = args.parentPath or table.concat(segments, ".")
			local parent, perr = Serialize.resolveParent(parentPath)
			if not parent then
				error("restore target parent missing: " .. tostring(perr) .. " (restore the parent first)")
			end
			local base = string.match(leaf, "^(.*) %(%d+%)$") or leaf
			local scriptInst = Instance.new(args.className or "ModuleScript")
			scriptInst.Name = base
			scriptInst.Source = args.source or ""
			return place(scriptInst, parent, replace)
		end

		-- rbxm: deserialize the whole unit, pick the wanted descendant
		local raw = EncodingService:Base64Decode(buffer.fromstring(args.data))
		local roots = SerializationService:DeserializeInstancesAsync(raw)
		local unit = roots[1]
		if not unit then
			error("mirror file held no instances")
		end
		local function cleanup()
			for _, r in ipairs(roots) do
				pcall(function()
					r:Destroy()
				end)
			end
		end

		local wanted, names = walk(unit, args.subPath or "")
		if not wanted then
			cleanup()
			return { found = false }
		end

		-- the live parent: an explicit parentPath, else the same spot it came from
		local parent, perr
		if args.parentPath then
			parent, perr = Serialize.resolveParent(args.parentPath)
		else
			local service = game:GetService(args.service)
			if #names == 0 then
				parent = service
			else
				local liveUnit = Serialize.findChild(service, args.unitName)
				if not liveUnit then
					perr = args.service .. "." .. args.unitName .. " is missing"
				else
					local parentNames = table.clone(names)
					table.remove(parentNames)
					local missing
					parent, missing = walkNames(liveUnit, parentNames)
					if not parent then
						perr = "'" .. tostring(missing) .. "' is missing on the way down"
					end
				end
			end
		end
		if not parent then
			cleanup()
			error("restore target parent missing: " .. tostring(perr)
				.. " (restore the parent path first, or pass parentPath)")
		end

		wanted.Parent = nil -- detach from the deserialized unit before the rest is destroyed
		if wanted ~= unit then
			cleanup()
		end
		return place(wanted, parent, replace)
	end)
end
