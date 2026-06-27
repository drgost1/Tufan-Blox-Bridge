--!nocheck
-- Output capture. We keep a CONTINUOUS ring buffer fed by LogService.MessageOut
-- from plugin boot, instead of only reading GetLogHistory on demand. Why:
--   * it survives ClearOutput (a common backdoor trick + normal Studio behaviour)
--   * it captures playtest output as it streams (so get_output_log returns
--     instantly from the buffer rather than risking a stalled on-demand read)
local LogService = game:GetService("LogService")
local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Parent.Net.Config)

local SEVERITY = {
	[Enum.MessageType.MessageOutput] = "output",
	[Enum.MessageType.MessageInfo] = "info",
	[Enum.MessageType.MessageWarning] = "warning",
	[Enum.MessageType.MessageError] = "error",
}

local BUFFER_MAX = 1500
local buffer = {} -- array of { sev, msg }, oldest first

-- Reactive error push: errors/warnings are queued here as they stream, then
-- flushed to the server every ~0.5s (see startErrorPush). The server keeps a
-- per-place feed so `get_recent_errors` returns instantly with no Studio round-
-- trip — the debug loop closes even while the plugin VM is busy in a playtest.
local pushQueue = {} -- array of { sev, msg, ts }

-- Seed once from whatever history already exists, then stream new lines.
for _, entry in ipairs(LogService:GetLogHistory()) do
	table.insert(buffer, { sev = SEVERITY[entry.messageType] or "output", msg = entry.message })
end
LogService.MessageOut:Connect(function(message, messageType)
	local sev = SEVERITY[messageType] or "output"
	table.insert(buffer, { sev = sev, msg = message })
	if #buffer > BUFFER_MAX then
		table.remove(buffer, 1)
	end
	if sev == "error" or sev == "warning" then
		table.insert(pushQueue, { sev = sev, msg = message, ts = os.time() })
		if #pushQueue > 300 then
			table.remove(pushQueue, 1)
		end
	end
end)

local pushStarted = false
local function startErrorPush(sessionId)
	if pushStarted then
		return
	end
	pushStarted = true
	task.spawn(function()
		while true do
			task.wait(0.5)
			if #pushQueue > 0 then
				local batch = pushQueue
				pushQueue = {}
				pcall(function()
					HttpService:RequestAsync({
						Url = Config.serverUrl .. "/studio-event",
						Method = "POST",
						Headers = { ["Content-Type"] = "application/json" },
						Body = HttpService:JSONEncode({ sessionId = sessionId, events = batch }),
					})
				end)
			end
		end
	end)
end

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

return function(register, ctx)
	if ctx and ctx.sessionId then
		startErrorPush(ctx.sessionId)
	end

	register("getOutputLog", function(args)
		return { lines = collect(args.maxEntries or 100, args.severity) }
	end)
end
