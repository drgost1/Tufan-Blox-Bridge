--!nocheck
-- Path resolution + value coercion between JSON (from the AI/server) and Roblox types.

local Serialize = {}

-- Resolve a dotted path like "ServerScriptService.MusicService" or
-- "game.Workspace.Part" or "Workspace.Part" to an Instance. Returns nil + err.
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
		local name = segments[i]
		local child = current:FindFirstChild(name)
		if not child then
			return nil, string.format("'%s' not found under '%s'", name, current:GetFullName())
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
	if t == "number" or t == "string" or t == "boolean" then
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
