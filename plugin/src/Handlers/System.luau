--!nocheck
-- ping/meta + honest stubs for capabilities Roblox does not expose to plugins.

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
		return { running = RunService:IsRunning() }
	end)

	-- No supported plugin API starts/stops a playtest. Be honest rather than fake.
	register("startPlaytest", function()
		error("start_playtest is not supported: Roblox provides no plugin API to start Play mode. Press F5 in Studio.")
	end)
	register("stopPlaytest", function()
		error("stop_playtest is not supported: Roblox provides no plugin API to stop Play mode. Press Shift+F5 in Studio.")
	end)

	-- CaptureService returns a temp content id, not pixels readable in Luau, so
	-- we can't return base64 image data from a plugin. Honest stub.
	register("captureScreenshot", function()
		error("capture_screenshot is not yet supported: Roblox does not expose viewport pixels to plugins. Planned via a different mechanism.")
	end)
end
