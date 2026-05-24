--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)

return function(register)
	register("getChildren", function(args)
		local inst, err = Serialize.resolveParent(args.path)
		if not inst then error(err) end
		local children = {}
		for _, c in ipairs(inst:GetChildren()) do
			table.insert(children, { name = c.Name, className = c.ClassName })
		end
		return { children = children }
	end)

	register("getDescendants", function(args)
		local inst, err = Serialize.resolveParent(args.path)
		if not inst then error(err) end
		local maxDepth = args.maxDepth or 5
		local out = {}
		local rootDepth = #string.split(Serialize.uniquePath(inst), ".")
		for _, d in ipairs(inst:GetDescendants()) do
			local depth = #string.split(Serialize.uniquePath(d), ".") - rootDepth
			if depth <= maxDepth then
				table.insert(out, { path = Serialize.uniquePath(d), className = d.ClassName, depth = depth })
				if #out >= 2000 then break end
			end
		end
		return { descendants = out }
	end)

	register("searchObjects", function(args)
		local root, err = Serialize.resolveParent(args.rootPath)
		if not root then error(err) end
		local classFilter = args.className
		local rawName = args.name
		local mode = args.matchMode or "substring"
		local caseSensitive = args.caseSensitive == true

		-- name matcher honouring matchMode (cuts the noise plain substring gives)
		local function nameMatches(instName)
			if not rawName then return true end
			local n, f = instName, rawName
			if not caseSensitive then n = string.lower(n); f = string.lower(f) end
			if mode == "exact" then
				return n == f
			elseif mode == "regex" then
				-- Lua pattern (not PCRE); bad patterns just don't match
				local ok, found = pcall(string.find, n, f)
				return ok and found ~= nil
			elseif mode == "wholeWord" then
				local escaped = (f:gsub("(%W)", "%%%1")) -- escape pattern specials
				local ok, found = pcall(string.find, n, "%f[%w]" .. escaped .. "%f[%W]")
				return ok and found ~= nil
			else -- substring (default), plain (no pattern) match
				return string.find(n, f, 1, true) ~= nil
			end
		end

		local CAP = 200
		local paths = {}
		local truncated = false
		for _, d in ipairs(root:GetDescendants()) do
			local classOk = (not classFilter) or d:IsA(classFilter)
			if classOk and nameMatches(d.Name) then
				table.insert(paths, Serialize.uniquePath(d))
				if #paths >= CAP then truncated = true; break end
			end
		end
		return { paths = paths, truncated = truncated }
	end)

	register("getServices", function()
		local services = {}
		for _, c in ipairs(game:GetChildren()) do
			table.insert(services, c.ClassName)
		end
		return { services = services }
	end)
end
