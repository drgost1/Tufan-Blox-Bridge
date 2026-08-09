--!nocheck
-- ping/meta + edit-vs-run state.
--
-- Playtest CONTROL (RunService:Run/Stop/Pause) and synthetic input used to live
-- here. Removed deliberately: Roblox's official Studio MCP owns play sessions
-- now (real Play Solo with a character, keyboard/mouse input, character
-- navigation) and does it better than plugin-side Run mode ever could. What
-- stays is `isRunning` — a read-only guard so the write tools can tell edit
-- mode from a live simulation before mutating.

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
end
