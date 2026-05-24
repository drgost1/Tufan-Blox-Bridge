--!nocheck
-- scan_backdoors — Tufan Power Tool. Scans scripts + attributes + Values for
-- backdoor / exploit / obfuscation signatures. Built from real free-model
-- backdoor techniques and community detection research (BeeScan, DevForum).
--
-- Categories: "script" (source), "attribute" (hidden payload on an instance),
-- "value" (payload in a StringValue). Severities: high / medium / low.

local HttpService = game:GetService("HttpService")

-- Line-level source signatures: { pattern, severity, label }. These are the
-- "presence" checks; require-of-Value and obfuscation get special precise logic.
local LINE_SIGS = {
	{ "getfenv", "high", "getfenv (environment tampering)" },
	{ "setfenv", "high", "setfenv (environment tampering)" },
	{ "loadstring", "high", "loadstring (dynamic code execution)" },
	{ "HttpGetAsync", "high", "HttpGetAsync (remote code fetch)" },
	{ "HttpGet", "high", "HttpGet (remote code fetch)" },
	{ "RequestInternal", "high", "RequestInternal (raw HTTP)" },
	{ "getgenv", "high", "getgenv (exploit global env)" },
	{ "getrenv", "high", "getrenv (exploit env)" },
	{ "getrawmetatable", "high", "getrawmetatable (exploit)" },
	{ "hookfunction", "high", "hookfunction (exploit hook)" },
	{ "hookmetamethod", "high", "hookmetamethod (exploit hook)" },
	{ "setreadonly", "high", "setreadonly (exploit)" },
	{ "checkcaller", "high", "checkcaller (exploit)" },
	{ "syn%.", "high", "syn. (Synapse exploit API)" },
	{ "http_request", "high", "http_request (exploit networking)" },
	{ "discord%.?c?o?m?/api/webhooks", "high", "Discord webhook (data exfiltration)" },
	{ "GetObjects", "medium", "GetObjects (remote asset load)" },
	{ "MarketplaceService", "low", "MarketplaceService (verify purchase prompts are yours)" },
	{ "LogService.-ClearOutput", "medium", "ClearOutput (trace suppression)" },
	{ "RunService:IsStudio", "low", "IsStudio check (possible anti-debug)" },
	{ "%.JobId", "low", "JobId check (possible studio/live evasion)" },
	{ "bit32%.bxor", "medium", "bit32.bxor (deobfuscation routine)" },
	{ "string%.reverse", "low", "string.reverse (possible obfuscation)" },
}

local function entropy(s: string): number
	local counts = {}
	for i = 1, #s do
		local b = string.byte(s, i)
		counts[b] = (counts[b] or 0) + 1
	end
	local e, n = 0, #s
	for _, c in pairs(counts) do
		local p = c / n
		e -= p * (math.log(p) / math.log(2))
	end
	return e
end

return function(register)
	register("scanBackdoors", function(args)
		local Serialize = require(script.Parent.Parent.Serialize.Instance)
		local root = game
		if args.rootPath and args.rootPath ~= "" and args.rootPath ~= "game" then
			local r = Serialize.resolve(args.rootPath)
			if r then root = r end
		end

		local pluginDebug = game:FindFirstChild("PluginDebugService")
		local findings = {}
		local scanned = 0

		local function add(category, severity, label, path, detail, snippet)
			table.insert(findings, {
				category = category, severity = severity, label = label,
				path = path, detail = detail, snippet = snippet,
			})
		end

		for _, d in ipairs(root:GetDescendants()) do
			if pluginDebug and d:IsDescendantOf(pluginDebug) then continue end

			-- 1. SCRIPT SOURCE
			if d:IsA("LuaSourceContainer") then
				scanned += 1
				local ok, src = pcall(function() return d.Source end)
				if ok and src then
					local lineNo = 0
					for line in (src .. "\n"):gmatch("(.-)\n") do
						lineNo += 1

						-- precise require-of-Value: require(<expr>.Value)
						for call in line:gmatch("require%s*%b()") do
							if call:find("%.Value%s*%)$") then
								add("script", "high", "require-of-Value (classic backdoor)", Serialize.uniquePath(d), "line " .. lineNo, line:gsub("^%s+", ""):sub(1, 120))
							elseif call:find("^require%s*%(%s*%d%d%d%d%d%d+") then
								add("script", "medium", "require by asset id (remote module)", Serialize.uniquePath(d), "line " .. lineNo, line:gsub("^%s+", ""):sub(1, 120))
							end
						end

						-- presence signatures
						for _, sig in ipairs(LINE_SIGS) do
							if string.find(line, sig[1]) then
								add("script", sig[2], sig[3], Serialize.uniquePath(d), "line " .. lineNo, line:gsub("^%s+", ""):sub(1, 120))
							end
						end

						-- obfuscation: long string.char chain
						if line:find("string%.char%(%s*%d+[%s,]+%d+[%s,]+%d+[%s,]+%d+[%s,]+%d+") then
							add("script", "medium", "long string.char chain (obfuscation)", Serialize.uniquePath(d), "line " .. lineNo, line:sub(1, 80))
						end
						-- obfuscation: long base64-ish blob, scored by entropy
						for blob in line:gmatch("[%w+/=]+") do
							if #blob >= 120 then
								local e = entropy(blob)
								if e > 4.3 then
									add("script", "high", string.format("high-entropy blob (%.1f bits, likely encrypted payload)", e), Serialize.uniquePath(d), "line " .. lineNo, blob:sub(1, 60) .. "...")
								end
							end
						end
						if #findings >= 2000 then break end
					end
				end
			end

			-- 2. ATTRIBUTES (where __readSrc-style payloads hide). The strong
			-- signal is a BINARY (invalid-UTF8) value — legit serialized data
			-- (JSON/base64) is valid UTF-8, so we don't flag that as high.
			local okA, attrs = pcall(function() return d:GetAttributes() end)
			if okA then
				for name, val in pairs(attrs) do
					if type(val) == "string" then
						if utf8.len(val) == nil then
							add("attribute", "high", "binary/invalid-UTF8 attribute (hidden payload)", Serialize.uniquePath(d), "@" .. name .. " (" .. #val .. " bytes)", nil)
						elseif name:match("^__") and #val >= 80 then
							add("attribute", "low", "hidden (__) attribute with data", Serialize.uniquePath(d), "@" .. name .. " (" .. #val .. " bytes)", nil)
						end
					elseif type(val) == "number" and val >= 100000000 and name:match("^__") then
						add("attribute", "medium", "hidden numeric attribute (possible asset id)", Serialize.uniquePath(d), "@" .. name .. " = " .. tostring(val), nil)
					end
				end
			end

			-- 3. STRING VALUES — only flag BINARY blobs (the malicious tell).
			-- Legit plugins store base64/JSON (valid UTF-8) in StringValues; not flagged.
			if d:IsA("StringValue") then
				local okV, v = pcall(function() return d.Value end)
				if okV and type(v) == "string" and #v >= 64 and utf8.len(v) == nil then
					add("value", "high", "StringValue holds a binary blob (possible payload)", Serialize.uniquePath(d), #v .. " bytes", nil)
				end
			end

			if #findings >= 2000 then break end
		end

		local rank = { high = 1, medium = 2, low = 3 }
		table.sort(findings, function(a, b) return (rank[a.severity] or 9) < (rank[b.severity] or 9) end)
		return { scanned = scanned, findings = findings }
	end)
end
