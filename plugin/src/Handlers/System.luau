--!nocheck
-- ping/meta + playtest (Run-mode) control. RunService:Run/Stop/Pause are
-- PluginSecurity, so a plugin CAN drive the Studio simulation. Run mode runs in
-- the SAME DataModel (no forked play session), so run_luau + get_playtest_output
-- keep working during a run — the automated build→test→inspect→fix loop.

local RunService = game:GetService("RunService")

return function(register, ctx)
	register("ping", function()
		return {
			placeName = game.Name,
			placeId = game.PlaceId,
			sessionId = ctx.sessionId,
			editMode = not RunService:IsRunning(),
		}
	end)

	register("isRunning", function()
		return { running = RunService:IsRunning(), runMode = RunService:IsRunMode() }
	end)

	-- Start "Run" mode: server scripts + physics, no player character. (Full Play
	-- Solo / F5 has no plugin API — that one is still manual.)
	register("startPlaytest", function()
		if RunService:IsRunning() then
			return { running = true, note = "already running" }
		end
		local ok, err = pcall(function() RunService:Run() end)
		if not ok then
			error("could not start Run mode: " .. tostring(err))
		end
		return {
			running = true,
			mode = "run",
			note = "Run mode started (server scripts + physics, no player character). run_luau + get_playtest_output work during the run. Full Play Solo (F5) has no plugin API — start that manually.",
		}
	end)

	register("stopPlaytest", function()
		if not RunService:IsRunning() then
			return { running = false, note = "not running" }
		end
		local ok, err = pcall(function() RunService:Stop() end)
		if not ok then
			error("could not stop simulation: " .. tostring(err))
		end
		return { running = false, note = "simulation stopped" }
	end)

	register("pausePlaytest", function()
		local ok, err = pcall(function() RunService:Pause() end)
		if not ok then
			error("could not pause simulation: " .. tostring(err))
		end
		return { paused = true, note = "simulation paused (resume by starting again / Stop to end)" }
	end)
end
