--!nocheck
-- Output capture. We keep a CONTINUOUS ring buffer fed by LogService.MessageOut
-- from plugin boot, instead of only reading GetLogHistory on demand. Why:
--   * it survives ClearOutput (a common backdoor trick + normal Studio behaviour)
--   * it captures playtest output as it streams (so get_playtest_output returns
--     instantly from the buffer rather than risking a stalled on-demand read)
local LogService = game:GetService("LogService")

local SEVERITY = {
	[Enum.MessageType.MessageOutput] = "output",
	[Enum.MessageType.MessageInfo] = "info",
	[Enum.MessageType.MessageWarning] = "warning",
	[Enum.MessageType.MessageError] = "error",
}

local BUFFER_MAX = 1500
local buffer = {} -- array of { sev, msg }, oldest first

-- Seed once from whatever history already exists, then stream new lines.
for _, entry in ipairs(LogService:GetLogHistory()) do
	table.insert(buffer, { sev = SEVERITY[entry.messageType] or "output", msg = entry.message })
end
LogService.MessageOut:Connect(function(message, messageType)
	table.insert(buffer, { sev = SEVERITY[messageType] or "output", msg = message })
	if #buffer > BUFFER_MAX then
		table.remove(buffer, 1)
	end
end)

local function collect(maxEntries, severityFilter)
	local lines = {}
	for _, e in ipairs(buffer) do
		if (not severityFilter) or e.sev == severityFilter then
			table.insert(lines, string.format("[%s] %s", e.sev, e.msg))
		end
	end
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
		-- Same buffer; during a playtest it includes the streamed play output.
		-- Roblox does not separate edit vs play output cleanly.
		return { lines = collect(args.maxEntries or 100, nil) }
	end)
end
