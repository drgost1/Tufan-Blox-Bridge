--!nocheck
-- Path resolution + value coercion between JSON (from the AI/server) and Roblox types.

local Serialize = {}

-- Same-named siblings collide on GetFullName(), so we disambiguate with a
-- " (N)" suffix where N is the 1-based index among same-named children (the
-- first keeps the bare name). e.g. Hawk_FlightPath01, Hawk_FlightPath01 (2)...

-- 1-based index of `inst` among siblings sharing its name; nil if it's unique.
local function siblingIndex(inst: Instance): number?
	local parent = inst.Parent
	if not parent then return nil end
	local count, idx = 0, 0
	for _, c in ipairs(parent:GetChildren()) do
		if c.Name == inst.Name then
			count += 1
			if c == inst then idx = count end
		end
	end
	return count > 1 and idx or nil
end

-- Find a child by a (possibly disambiguated) segment: "Name" -> FindFirstChild;
-- "Name (N)" -> the Nth child named "Name".
local function findChild(parent: Instance, segment: string): Instance?
	local base, num = string.match(segment, "^(.*) %((%d+)%)$")
	if base then
		local n = tonumber(num)
		local count = 0
		for _, c in ipairs(parent:GetChildren()) do
			if c.Name == base then
				count += 1
				if count == n then return c end
			end
		end
		return nil
	end
	return parent:FindFirstChild(segment)
end

-- GetFullName-style path with " (N)" disambiguators for duplicate siblings.
function Serialize.uniquePath(inst: Instance): string
	local segs = {}
	local cur: Instance? = inst
	while cur and cur ~= game do
		local name = cur.Name
		local i = siblingIndex(cur)
		if i and i > 1 then
			name = name .. " (" .. i .. ")"
		end
		table.insert(segs, 1, name)
		cur = cur.Parent
	end
	return table.concat(segs, ".")
end

-- Resolve a dotted path like "ServerScriptService.MusicService" or
-- "game.Workspace.Part" or "Workspace.Birds.Hawk_FlightPath01 (3).Script".
function Serialize.resolve(path: string): (Instance?, string?)
	if path == nil or path == "" then
		return nil, "empty path"
	end

	local segments = string.split(path, ".")
	local current: Instance = game
	local startIndex = 1

	if segments[1] == "game" or segments[1] == "Game" then
		startIndex = 2
	end

	-- First real segment may be a service.
	if startIndex <= #segments then
		local first = segments[startIndex]
		local ok, service = pcall(function()
			return game:GetService(first)
		end)
		if ok and service then
			current = service
			startIndex += 1
		end
	end

	for i = startIndex, #segments do
		local child = findChild(current, segments[i])
		if not child then
			return nil, string.format("'%s' not found under '%s'", segments[i], current:GetFullName())
		end
		current = child
	end

	return current, nil
end

-- Resolve a parent path; "game"/"" returns game, otherwise normal resolve.
function Serialize.resolveParent(path: string?): (Instance?, string?)
	if path == nil or path == "" or path == "game" or path == "Game" then
		return game, nil
	end
	return Serialize.resolve(path)
end

-- Convert a Roblox value to a JSON-safe representation.
function Serialize.encodeValue(value: any): any
	local t = typeof(value)
	if t == "string" then
		-- guard against invalid UTF-8 (JSONEncode throws on it)
		if utf8.len(value) == nil then
			return string.format("<binary string, %d bytes>", #value)
		end
		return value
	elseif t == "number" then
		if value ~= value or value == math.huge or value == -math.huge then
			return tostring(value) -- NaN/inf -> string (JSONEncode rejects them)
		end
		return value
	elseif t == "boolean" then
		return value
	elseif t == "nil" then
		return nil
	elseif t == "Vector3" then
		return { Vector3 = { value.X, value.Y, value.Z } }
	elseif t == "Vector2" then
		return { Vector2 = { value.X, value.Y } }
	elseif t == "Color3" then
		return { Color3 = { value.R, value.G, value.B } }
	elseif t == "UDim" then
		return { UDim = { value.Scale, value.Offset } }
	elseif t == "UDim2" then
		return { UDim2 = { value.X.Scale, value.X.Offset, value.Y.Scale, value.Y.Offset } }
	elseif t == "CFrame" then
		return { CFrame = { value:GetComponents() } }
	elseif t == "EnumItem" then
		return { EnumItem = tostring(value) }
	elseif t == "BrickColor" then
		return { BrickColor = value.Name }
	elseif t == "Instance" then
		return { Instance = value:GetFullName() }
	else
		return tostring(value)
	end
end

-- Convert a JSON value (from the AI) to a Roblox value.
function Serialize.decodeValue(value: any): any
	local t = type(value)
	if t == "number" or t == "string" or t == "boolean" then
		return value
	end
	if t ~= "table" then
		return value
	end

	if value.Vector3 then
		local v = value.Vector3
		return Vector3.new(v[1], v[2], v[3])
	elseif value.Vector2 then
		local v = value.Vector2
		return Vector2.new(v[1], v[2])
	elseif value.Color3 then
		local v = value.Color3
		return Color3.new(v[1], v[2], v[3])
	elseif value.UDim then
		local v = value.UDim
		return UDim.new(v[1], v[2])
	elseif value.UDim2 then
		local v = value.UDim2
		return UDim2.new(v[1], v[2], v[3], v[4])
	elseif value.CFrame then
		return CFrame.new(table.unpack(value.CFrame))
	elseif value.EnumItem then
		-- "Enum.Material.Wood" -> Enum.Material.Wood
		local parts = string.split(value.EnumItem, ".")
		if parts[1] == "Enum" and #parts == 3 then
			local enum = (Enum :: any)[parts[2]]
			return enum and enum[parts[3]] or nil
		end
		return nil
	elseif value.BrickColor then
		return BrickColor.new(value.BrickColor)
	end
	return value
end

return Serialize
