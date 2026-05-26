--!nocheck
-- describe: one call returns an instance's FULL context — identity, properties,
-- attributes, tags, a class-bucketed child summary, attached scripts, and world
-- bounds. Replaces the 5-6 round-trips (get_properties + get_children +
-- get_attributes + get_tags + grep for scripts) it used to take to understand a node.
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local CollectionService = game:GetService("CollectionService")

local COMMON = {
	"Name", "ClassName", "Archivable", "Enabled", "Disabled", "Visible", "Value",
	"Text", "Position", "Size", "Orientation", "CFrame", "Anchored", "CanCollide",
	"Transparency", "Color", "Material", "BrickColor", "MeshId", "TextureID",
	"PrimaryPart", "Adornee", "RenderFidelity",
}

return function(register)
	register("describe", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end

		local out = {
			path = Serialize.uniquePath(inst),
			name = inst.Name,
			className = inst.ClassName,
		}

		-- properties (best-effort common set; Roblox has no full reflection in plugins)
		local props = {}
		for _, name in ipairs(COMMON) do
			if name ~= "Name" and name ~= "ClassName" then
				local ok, value = pcall(function() return inst[name] end)
				if ok and value ~= nil then
					props[name] = Serialize.encodeValue(value)
				end
			end
		end
		out.properties = props

		-- attributes
		local attrs = {}
		for k, v in pairs(inst:GetAttributes()) do
			attrs[k] = Serialize.encodeValue(v)
		end
		out.attributes = attrs

		-- tags
		out.tags = CollectionService:GetTags(inst)

		-- child summary (class -> count) + total descendants
		local childByClass, childCount = {}, 0
		for _, c in ipairs(inst:GetChildren()) do
			childByClass[c.ClassName] = (childByClass[c.ClassName] or 0) + 1
			childCount += 1
		end
		out.children = childByClass
		out.childCount = childCount

		-- attached scripts (descendant source containers) + line counts
		local scripts = {}
		for _, d in ipairs(inst:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				local lines = 0
				local ok, src = pcall(function() return d.Source end)
				if ok and src then
					local _, n = src:gsub("\n", "\n")
					lines = n + 1
				end
				table.insert(scripts, { path = Serialize.uniquePath(d), className = d.ClassName, lines = lines })
				if #scripts >= 50 then break end
			end
		end
		out.scripts = scripts

		-- world bounds for parts / models
		pcall(function()
			if inst:IsA("BasePart") then
				out.size = { inst.Size.X, inst.Size.Y, inst.Size.Z }
				out.position = { inst.Position.X, inst.Position.Y, inst.Position.Z }
			elseif inst:IsA("Model") then
				local cf, size = inst:GetBoundingBox()
				out.size = { size.X, size.Y, size.Z }
				local p = cf.Position
				out.position = { p.X, p.Y, p.Z }
			end
		end)

		return out
	end)
end
