--!nocheck
local LogService = game:GetService("LogService")
local Serialize = require(script.Parent.Parent.Serialize.Instance)

return function(register)
	register("runLuau", function(args)
		local fn, compileErr = loadstring(args.code)
		if not fn then
			error("compile error: " .. tostring(compileErr))
		end

		-- Capture prints emitted during execution.
		local logs = {}
		local conn = LogService.MessageOut:Connect(function(message, _type)
			table.insert(logs, message)
		end)

		local ok, result = pcall(fn)
		task.wait() -- let queued MessageOut events flush
		conn:Disconnect()

		if not ok then
			error("runtime error: " .. tostring(result))
		end

		-- Structured result: tables/Roblox-types come back as real JSON data
		-- (not tostring'd) so the AI can read fields directly. Primitives keep
		-- the old `result` string for back-compat.
		local resultStr, resultJson
		if result ~= nil then
			if typeof(result) == "table" then
				local okEnc, enc = pcall(Serialize.encodeDeep, result)
				resultJson = okEnc and enc or nil
				if not okEnc then resultStr = tostring(result) end
			else
				local okEncode, encoded = pcall(function()
					if typeof(result) == "Instance" then return result:GetFullName() end
					return tostring(result)
				end)
				resultStr = okEncode and encoded or tostring(result)
			end
		end

		return { result = resultStr, resultJson = resultJson, logs = logs }
	end)
end
