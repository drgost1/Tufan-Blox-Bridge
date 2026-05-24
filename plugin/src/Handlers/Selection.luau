--!nocheck
local Selection = game:GetService("Selection")

return function(register)
	register("getSelection", function()
		local paths = {}
		for _, inst in ipairs(Selection:Get()) do
			table.insert(paths, { path = inst:GetFullName(), className = inst.ClassName })
		end
		return { selection = paths }
	end)

	register("setSelection", function(args)
		local Serialize = require(script.Parent.Parent.Serialize.Instance)
		local instances = {}
		for _, path in ipairs(args.paths or {}) do
			local inst = Serialize.resolve(path)
			if inst then table.insert(instances, inst) end
		end
		Selection:Set(instances)
		return { count = #instances }
	end)
end
