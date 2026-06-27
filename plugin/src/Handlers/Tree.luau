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
		-- single O(n) pass: path + depth come straight from the traversal
		Serialize.forEachDescendantPath(inst, function(d, path, depth)
			if depth <= maxDepth then
				table.insert(out, { path = path, className = d.ClassName, depth = depth })
				if #out >= 2000 then return false end
			end
		end)
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
		Serialize.forEachDescendantPath(root, function(d, path)
			local classOk = (not classFilter) or d:IsA(classFilter)
			if classOk and nameMatches(d.Name) then
				table.insert(paths, path)
				if #paths >= CAP then
					truncated = true
					return false
				end
			end
		end)
		return { paths = paths, truncated = truncated }
	end)

	register("getServices", function()
		local services = {}
		for _, c in ipairs(game:GetChildren()) do
			table.insert(services, c.ClassName)
		end
		return { services = services }
	end)

	-- getTree: a token-lean descendant dump. Runs of same-class siblings beyond
	-- `collapseMin` (default 6) are folded into one "ClassName ×N" line instead of
	-- listing every one — so a model with 4000 Parts costs ~1 line, not 4000.
	register("getTree", function(args)
		local inst, err = Serialize.resolveParent(args.path)
		if not inst then error(err) end
		local maxDepth = args.maxDepth or 4
		local collapseMin = args.collapseMin or 6
		local classFilter = args.className
		local out = {}
		local nodes = 0

		local function walk(parent, depth)
			if depth > maxDepth then
				return
			end
			-- bucket children by className, preserving first-seen order
			local order, byClass = {}, {}
			for _, c in ipairs(parent:GetChildren()) do
				if not byClass[c.ClassName] then
					byClass[c.ClassName] = {}
					table.insert(order, c.ClassName)
				end
				table.insert(byClass[c.ClassName], c)
			end
			for _, cls in ipairs(order) do
				if nodes >= 4000 then
					return
				end
				local group = byClass[cls]
				if #group > collapseMin then
					-- collapse the whole run; do not recurse (repetitive leaves).
					-- honour the className filter via a representative child (group[1])
					if (not classFilter) or group[1]:IsA(classFilter) then
						table.insert(out, { depth = depth, text = string.format("%s ×%d", cls, #group), collapsed = true })
						nodes += 1
					end
				else
					for _, c in ipairs(group) do
						if (not classFilter) or c:IsA(classFilter) then
							table.insert(out, { depth = depth, text = string.format("%s  %s", c.ClassName, c.Name) })
							nodes += 1
						end
						if nodes >= 4000 then
							return
						end
						walk(c, depth + 1)
					end
				end
			end
		end

		walk(inst, 1)
		return { lines = out, count = nodes }
	end)
end
