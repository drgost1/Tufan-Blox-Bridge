--!nocheck
-- Applies a files->Studio change: create/update/delete a script at a studio path.
-- Registered as the "applyFileChange" op.

local Serialize = require(script.Parent.Parent.Serialize.Instance)

-- Walk/create the path, returning the leaf script instance (creating it with
-- className if missing). Intermediate missing nodes become Folders.
local function ensureScript(studioPath: string, className: string)
	local segments = string.split(studioPath, ".")
	local current: Instance = game
	local startIndex = 1

	-- first segment is a service
	local ok, service = pcall(function() return game:GetService(segments[1]) end)
	if ok and service then
		current = service
		startIndex = 2
	end

	for i = startIndex, #segments do
		local name = segments[i]
		local isLeaf = (i == #segments)
		local child = current:FindFirstChild(name)
		if not child then
			if isLeaf then
				child = Instance.new(className)
			else
				child = Instance.new("Folder")
			end
			child.Name = name
			child.Parent = current
		end
		current = child
	end
	return current
end

return function(register, ctx)
	register("applyFileChange", function(args)
		-- Suppress the ScriptWatcher echo for this path: this change came FROM
		-- the filesystem, so we must not POST it back as a studio-change.
		if ctx and ctx.suppress then
			ctx.suppress(args.studioPath)
		end

		if args.kind == "delete" then
			local inst = Serialize.resolve(args.studioPath)
			if inst then inst:Destroy() end
			return { ok = true, deleted = true }
		end

		-- upsert
		local className = args.className or "ModuleScript"
		local inst = ensureScript(args.studioPath, className)
		if inst:IsA("LuaSourceContainer") then
			if inst.Source ~= args.source then
				inst.Source = args.source
			end
		end
		return { ok = true, path = inst:GetFullName() }
	end)
end
