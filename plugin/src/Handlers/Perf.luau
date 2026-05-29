--!nocheck
-- scanPerf: a single O(n) pass over the DataModel that tallies the usual Roblox
-- frame-killers. The server turns these raw counts into a ranked fix list.
local Workspace = game:GetService("Workspace")

local LOOP_CAP = 25 -- max busy-loop scripts to report

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
					-- a `while true do` with NO yield anywhere in the file is the
					-- classic frame-killer / hang. Heuristic, labeled as such.
					if ok and type(src) == "string" and src:find("while%s+true%s+do") then
						local yields = src:find("wait")
							or src:find("RunService")
							or src:find("Heartbeat")
							or src:find("Stepped")
						if not yields then
							table.insert(busyLoops, d:GetFullName())
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
