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
		local nameFilter = args.name and string.lower(args.name) or nil
		local classFilter = args.className
		local paths = {}
		for _, d in ipairs(root:GetDescendants()) do
			local nameOk = (not nameFilter) or string.find(string.lower(d.Name), nameFilter, 1, true)
			local classOk = (not classFilter) or d:IsA(classFilter)
			if nameOk and classOk then
				table.insert(paths, Serialize.uniquePath(d))
				if #paths >= 500 then break end
			end
		end
		return { paths = paths }
	end)

	register("getServices", function()
		local services = {}
		for _, c in ipairs(game:GetChildren()) do
			table.insert(services, c.ClassName)
		end
		return { services = services }
	end)
end
