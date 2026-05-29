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

-- Single-pass O(n) descendant traversal that builds each node's disambiguated
-- path the SAME way uniquePath does — but top-down, without the per-node walk up
-- the ancestor chain (uniquePath is O(depth × siblings) per call; calling it for
-- every descendant is ~O(n²) on wide trees). Calls visit(inst, path, depth) for
-- each descendant of `root` (root excluded); depth = 1 for direct children.
-- Return false from `visit` to stop the whole traversal early (cheap caps).
function Serialize.forEachDescendantPath(root: Instance, visit: (Instance, string, number) -> boolean?)
	local rootPath = (root == game) and "" or Serialize.uniquePath(root)
	local stopped = false
	local function recurse(parent: Instance, parentPath: string, depth: number)
		local children = parent:GetChildren()
		-- count each name first so we know which need a " (N)" suffix
		local total = {}
		for _, c in ipairs(children) do
			total[c.Name] = (total[c.Name] or 0) + 1
		end
		local seen = {}
		for _, c in ipairs(children) do
			if stopped then return end
			local name = c.Name
			local k = (seen[name] or 0) + 1
			seen[name] = k
			-- first same-named sibling keeps the bare name; rest get " (k)"
			local seg = (total[name] > 1 and k > 1) and (name .. " (" .. k .. ")") or name
			local path = parentPath == "" and seg or (parentPath .. "." .. seg)
			if visit(c, path, depth) == false then
				stopped = true
				return
			end
			recurse(c, path, depth + 1)
		end
	end
	recurse(root, rootPath, 1)
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
	elseif t == "NumberRange" then
		return { NumberRange = { value.Min, value.Max } }
	elseif t == "Rect" then
		return { Rect = { value.Min.X, value.Min.Y, value.Max.X, value.Max.Y } }
	elseif t == "NumberSequence" then
		local kps = {}
		for _, kp in ipairs(value.Keypoints) do
			table.insert(kps, { kp.Time, kp.Value, kp.Envelope })
		end
		return { NumberSequence = kps }
	elseif t == "ColorSequence" then
		local kps = {}
		for _, kp in ipairs(value.Keypoints) do
			table.insert(kps, { kp.Time, { kp.Value.R, kp.Value.G, kp.Value.B } })
		end
		return { ColorSequence = kps }
	elseif t == "Font" then
		return { Font = { value.Family, value.Weight.Name, value.Style.Name } }
	elseif t == "PhysicalProperties" then
		return { PhysicalProperties = { value.Density, value.Friction, value.Elasticity, value.FrictionWeight, value.ElasticityWeight } }
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
	elseif value.NumberRange then
		local v = value.NumberRange
		return NumberRange.new(v[1], v[2])
	elseif value.Rect then
		local v = value.Rect
		return Rect.new(v[1], v[2], v[3], v[4])
	elseif value.NumberSequence then
		local v = value.NumberSequence
		if type(v) == "number" then
			return NumberSequence.new(v) -- flat sequence shorthand
		end
		local kps = {}
		for _, kp in ipairs(v) do
			table.insert(kps, NumberSequenceKeypoint.new(kp[1], kp[2], kp[3] or 0))
		end
		return NumberSequence.new(kps)
	elseif value.ColorSequence then
		local kps = {}
		for _, kp in ipairs(value.ColorSequence) do
			local c = kp[2]
			table.insert(kps, ColorSequenceKeypoint.new(kp[1], Color3.new(c[1], c[2], c[3])))
		end
		return ColorSequence.new(kps)
	elseif value.Font then
		local v = value.Font
		local weight = (v[2] and Enum.FontWeight[v[2]]) or Enum.FontWeight.Regular
		local style = (v[3] and Enum.FontStyle[v[3]]) or Enum.FontStyle.Normal
		return Font.new(v[1], weight, style)
	elseif value.PhysicalProperties then
		local v = value.PhysicalProperties
		return PhysicalProperties.new(v[1], v[2], v[3], v[4] or 1, v[5] or 1)
	end
	return value
end

-- Deep-encode a returned value into a JSON-safe structure: tables recurse,
-- Roblox types go through encodeValue, with depth/size/cycle guards so a returned
-- `workspace` or a cyclic table can't blow up the response.
function Serialize.encodeDeep(value: any, maxDepth: number?, maxKeys: number?): any
	local MAX_DEPTH = maxDepth or 6
	local MAX_KEYS = maxKeys or 200
	local function walk(v, depth, seen)
		if typeof(v) == "table" then
			if depth >= MAX_DEPTH then return "<table: max depth>" end
			if seen[v] then return "<cycle>" end
			seen[v] = true
			local out, n = {}, 0
			for k, val in pairs(v) do
				n += 1
				if n > MAX_KEYS then
					out["__truncated"] = true
					break
				end
				out[tostring(k)] = walk(val, depth + 1, seen)
			end
			seen[v] = nil
			return out
		elseif typeof(v) == "Instance" then
			return v:GetFullName()
		else
			return Serialize.encodeValue(v)
		end
	end
	return walk(value, 0, {})
end

return Serialize
