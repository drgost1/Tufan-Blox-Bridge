--!nocheck
local LogService = game:GetService("LogService")

local SEVERITY = {
	[Enum.MessageType.MessageOutput] = "output",
	[Enum.MessageType.MessageInfo] = "info",
	[Enum.MessageType.MessageWarning] = "warning",
	[Enum.MessageType.MessageError] = "error",
}

local function collect(maxEntries, severityFilter)
	local history = LogService:GetLogHistory()
	local lines = {}
	for _, entry in ipairs(history) do
		local sev = SEVERITY[entry.messageType] or "output"
		if (not severityFilter) or sev == severityFilter then
			table.insert(lines, string.format("[%s] %s", sev, entry.message))
		end
	end
	-- keep the last maxEntries
	if #lines > maxEntries then
		local trimmed = {}
		for i = #lines - maxEntries + 1, #lines do
			table.insert(trimmed, lines[i])
		end
		lines = trimmed
	end
	return lines
end

return function(register)
	register("getOutputLog", function(args)
		return { lines = collect(args.maxEntries or 100, args.severity) }
	end)

	register("getPlaytestOutput", function(args)
		-- In edit mode this is the same history buffer; during a playtest it
		-- includes play output. Roblox does not separate the two cleanly.
		return { lines = collect(args.maxEntries or 100, nil) }
	end)
end
