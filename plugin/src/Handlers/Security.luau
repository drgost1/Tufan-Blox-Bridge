--!nocheck
-- scan_backdoors — scans every script's Source for known malicious / exploit
-- patterns. Built from real free-model backdoor techniques (incl. the
-- require-of-ObjectValue trick that hides behind fake lighting/texture libs).

-- { luaPattern, severity, label }
local SIGNATURES = {
	{ "require%s*%(.-%.Value", "high", "require-of-Value (classic backdoor)" },
	{ "require%s*%(%s*%d%d%d%d+", "medium", "require by asset id (remote module)" },
	{ "getfenv", "high", "getfenv (environment tampering)" },
	{ "setfenv", "high", "setfenv (environment tampering)" },
	{ "loadstring", "high", "loadstring (dynamic code execution)" },
	{ "HttpGet", "high", "HttpGet (remote code fetch)" },
	{ "HttpGetAsync", "high", "HttpGetAsync (remote code fetch)" },
	{ "GetObjects", "medium", "GetObjects (remote asset load)" },
	{ "getgenv", "high", "getgenv (exploit global env)" },
	{ "getrenv", "high", "getrenv (exploit env)" },
	{ "hookfunction", "high", "hookfunction (exploit hook)" },
	{ "hookmetamethod", "high", "hookmetamethod (exploit hook)" },
	{ "firetouchinterest", "medium", "firetouchinterest (exploit)" },
	{ "fireclickdetector", "medium", "fireclickdetector (exploit)" },
	{ "syn%.", "high", "syn. (Synapse exploit API)" },
	{ "http_request", "high", "http_request (exploit networking)" },
	{ "[\"'][A-Za-z0-9+/]+=[\"']%s*%.%.", "low", "possible base64 blob" },
	{ "string%.char%(%d+[,%s]+%d+[,%s]+%d+[,%s]+%d+[,%s]+%d+", "medium", "long string.char chain (obfuscation)" },
	{ "\\%d%d%d\\%d%d%d\\%d%d%d", "medium", "decimal-escape blob (obfuscation)" },
}

return function(register)
	register("scanBackdoors", function(args)
		local rootName = args.rootPath
		local root = game
		if rootName and rootName ~= "" and rootName ~= "game" then
			local Serialize = require(script.Parent.Parent.Serialize.Instance)
			local r = Serialize.resolve(rootName)
			if r then root = r end
		end

		local pluginDebug = game:FindFirstChild("PluginDebugService")

		local findings = {}
		local scanned = 0
		for _, d in ipairs(root:GetDescendants()) do
			-- skip plugin code (incl. this scanner's own signature list)
			if pluginDebug and d:IsDescendantOf(pluginDebug) then
				continue
			end
			if d:IsA("LuaSourceContainer") then
				scanned += 1
				local ok, src = pcall(function() return d.Source end)
				if ok and src then
					local lineNo = 0
					for line in (src .. "\n"):gmatch("(.-)\n") do
						lineNo += 1
						for _, sig in ipairs(SIGNATURES) do
							if string.find(line, sig[1]) then
								table.insert(findings, {
									path = d:GetFullName(),
									line = lineNo,
									severity = sig[2],
									label = sig[3],
									snippet = string.sub((line:gsub("^%s+", "")), 1, 120),
								})
							end
						end
						if #findings >= 1000 then break end
					end
				end
			end
		end

		-- sort high -> low
		local rank = { high = 1, medium = 2, low = 3 }
		table.sort(findings, function(a, b) return (rank[a.severity] or 9) < (rank[b.severity] or 9) end)
		return { scanned = scanned, findings = findings }
	end)
end
