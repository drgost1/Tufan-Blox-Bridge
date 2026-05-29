--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local CollectionService = game:GetService("CollectionService")

return function(register)
	register("getTags", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		return { tags = inst:GetTags() }
	end)

	register("addTag", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		inst:AddTag(args.tag)
		return { ok = true }
	end)

	register("removeTag", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		inst:RemoveTag(args.tag)
		return { ok = true }
	end)

	register("getTagged", function(args)
		local className = args.className
		local paths = {}
		for _, inst in ipairs(CollectionService:GetTagged(args.tag)) do
			if not className or inst:IsA(className) then
				table.insert(paths, Serialize.uniquePath(inst))
			end
		end
		return { paths = paths }
	end)
end
