--!nocheck
local LogService = game:GetService("LogService")

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

		local resultStr
		if result ~= nil then
			local okEncode, encoded = pcall(function()
				if typeof(result) == "Instance" then return result:GetFullName() end
				return tostring(result)
			end)
			resultStr = okEncode and encoded or tostring(result)
		end

		return { result = resultStr, logs = logs }
	end)
end
