--!nocheck
-- Only insertAsset runs in the plugin. Catalog search/details run server-side
-- (HttpService cannot reach roblox.com domains from a plugin).

local Serialize = require(script.Parent.Parent.Serialize.Instance)
local InsertService = game:GetService("InsertService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

return function(register)
	register("insertAsset", function(args)
		local parent, err = Serialize.resolveParent(args.parentPath)
		if not parent then error(err) end

		local recordingId = ChangeHistoryService:TryBeginRecording("TufanBridge: insert asset")
		local ok, model = pcall(function()
			return InsertService:LoadAsset(args.assetId)
		end)
		if not ok then
			if recordingId then
				ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Cancel)
			end
			error("LoadAsset failed: " .. tostring(model))
		end

		-- LoadAsset returns a Model wrapper; reparent its children to the target.
		local inserted = model
		local children = model:GetChildren()
		if #children == 1 then
			inserted = children[1]
			inserted.Parent = parent
			model:Destroy()
		else
			model.Parent = parent
		end

		if recordingId then
			ChangeHistoryService:FinishRecording(recordingId, Enum.FinishRecordingOperation.Commit)
		end
		return { path = Serialize.uniquePath(inserted) }
	end)
end
