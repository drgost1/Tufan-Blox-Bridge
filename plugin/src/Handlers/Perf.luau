--!nocheck
-- scanPerf: a single O(n) pass over the DataModel that tallies the usual Roblox
-- frame-killers. The server turns these raw counts into a ranked fix list.
local Workspace = game:GetService("Workspace")

local LOOP_CAP = 25 -- max busy-loop scripts to report

-- A real yield CALL — `wait(...)`, `task.wait(...)` or `someSignal:Wait()`. A
-- bare substring (a comment, an identifier like `await`) must NOT count.
local function bodyYields(body)
	return body:find("%f[%w]wait%s*%(") ~= nil
		or body:find("task%.wait%s*%(") ~= nil
		or body:find(":Wait%s*%(") ~= nil
end

-- Block-open keywords that each need a matching `end`. `while`/`for` open via
-- their trailing `do`, so we only count `do`/`then`/`function`/`repeat`.
local BLOCK_OPENERS = { ["do"] = true, ["then"] = true, ["function"] = true, ["repeat"] = true }

-- Return the source slice from `startIdx` up to the `end`/`until` that matches the
-- block already open at depth 1 — i.e. the body of a `while true do`. Skips
-- comments and string literals so keywords inside them don't skew the count
-- (e.g. a `-- the end` comment can't truncate the body early).
local function matchingBlockBody(src, startIdx)
	local depth = 1
	local i = startIdx
	local n = #src
	while i <= n do
		if src:sub(i, i + 1) == "--" then
			local eqs = src:match("^%-%-%[(=*)%[", i)
			if eqs then
				local close = "]" .. eqs .. "]"
				local e = src:find(close, i + 4, true)
				i = e and (e + #close) or (n + 1)
			else
				local e = src:find("\n", i, true)
				i = e and (e + 1) or (n + 1)
			end
		elseif src:sub(i, i) == '"' or src:sub(i, i) == "'" then
			local q = src:sub(i, i)
			local j = i + 1
			while j <= n do
				local cc = src:sub(j, j)
				if cc == "\\" then
					j = j + 2
				elseif cc == q then
					j = j + 1
					break
				else
					j = j + 1
				end
			end
			i = j
		elseif src:match("^%[=*%[", i) then
			local eqs = src:match("^%[(=*)%[", i)
			local close = "]" .. eqs .. "]"
			local e = src:find(close, i, true)
			i = e and (e + #close) or (n + 1)
		else
			local word = src:match("^[%a_][%w_]*", i)
			if word then
				if word == "end" or word == "until" then
					depth = depth - 1
					if depth == 0 then
						return src:sub(startIdx, i - 1)
					end
				elseif word == "elseif" then
					depth = depth - 1 -- cancels the `then` that follows it
				elseif BLOCK_OPENERS[word] then
					depth = depth + 1
				end
				i = i + #word
			else
				i = i + 1
			end
		end
	end
	return src:sub(startIdx) -- unterminated; treat the remainder as the body
end

return function(register)
	register("scanPerf", function()
		local s = {
			total = 0,
			parts = 0,
			unanchored = 0,
			unions = 0,
			meshparts = 0,
			untexturedMesh = 0,
			preciseMesh = 0,
			decals = 0,
			textures = 0,
			lights = 0,
			shadowLights = 0,
			particles = 0,
			scripts = 0,
			welds = 0,
			constraints = 0,
		}
		local busyLoops = {}
		local streamingEnabled = false
		pcall(function()
			streamingEnabled = Workspace.StreamingEnabled
		end)

		for _, d in ipairs(game:GetDescendants()) do
			s.total += 1
			if d:IsA("BasePart") then
				s.parts += 1
				if not d.Anchored then
					s.unanchored += 1
				end
			end
			if d:IsA("UnionOperation") or d:IsA("NegateOperation") then
				s.unions += 1
			end
			if d:IsA("MeshPart") then
				s.meshparts += 1
				if d.TextureID == "" then
					s.untexturedMesh += 1
				end
				if d.RenderFidelity == Enum.RenderFidelity.Precise then
					s.preciseMesh += 1
				end
			end
			if d:IsA("Decal") then
				s.decals += 1
			elseif d:IsA("Texture") then
				s.textures += 1
			elseif d:IsA("Light") then
				s.lights += 1
				if d.Shadows then
					s.shadowLights += 1
				end
			elseif d:IsA("ParticleEmitter") then
				s.particles += 1
			elseif d:IsA("WeldConstraint") or d:IsA("Weld") then
				s.welds += 1
			elseif d:IsA("Constraint") then
				s.constraints += 1
			elseif d:IsA("LuaSourceContainer") then
				s.scripts += 1
				if #busyLoops < LOOP_CAP then
					local ok, src = pcall(function()
						return d.Source
					end)
					-- a `while true do` whose BODY performs no yielding call is the
					-- classic frame-killer / hang. We scope the check to the loop body
					-- (up to its matching `end`) and require a real yield call, so a
					-- `wait` substring elsewhere in the file can't mask a true hang.
					if ok and type(src) == "string" then
						local searchFrom = 1
						while true do
							local _, doEnd = src:find("while%s+true%s+do", searchFrom)
							if not doEnd then
								break
							end
							if not bodyYields(matchingBlockBody(src, doEnd + 1)) then
								table.insert(busyLoops, d:GetFullName())
								break
							end
							searchFrom = doEnd + 1
						end
					end
				end
			end
		end

		return {
			stats = s,
			streamingEnabled = streamingEnabled,
			busyLoops = busyLoops,
		}
	end)

	-- projectHealth: one-look census of the whole place. One traversal total (sum
	-- over each top-level service's descendants), which also yields the per-service
	-- breakdown. The server formats it into a dashboard.
	register("projectHealth", function()
		local CollectionService = game:GetService("CollectionService")
		local c = { instances = 0, scripts = 0, scriptBytes = 0, parts = 0, meshparts = 0, unions = 0, particles = 0, lights = 0 }
		local byService = {}
		for _, svc in ipairs(game:GetChildren()) do
			local ok, kids = pcall(function() return svc:GetDescendants() end)
			if ok then
				if #kids > 0 then byService[svc.Name] = #kids end
				for _, d in ipairs(kids) do
					c.instances += 1
					if d:IsA("LuaSourceContainer") then
						c.scripts += 1
						local sok, src = pcall(function() return d.Source end)
						if sok and type(src) == "string" then c.scriptBytes += #src end
					elseif d:IsA("MeshPart") then
						c.parts += 1
						c.meshparts += 1
					elseif d:IsA("UnionOperation") then
						c.parts += 1
						c.unions += 1
					elseif d:IsA("BasePart") then
						c.parts += 1
					elseif d:IsA("ParticleEmitter") then
						c.particles += 1
					elseif d:IsA("Light") then
						c.lights += 1
					end
				end
			end
		end
		local tags = {}
		pcall(function() tags = CollectionService:GetAllTags() end)
		local streaming = false
		pcall(function() streaming = Workspace.StreamingEnabled end)
		return {
			counts = c,
			byService = byService,
			tagCount = #tags,
			streamingEnabled = streaming,
			placeName = game.Name,
			placeId = game.PlaceId,
		}
	end)
end
