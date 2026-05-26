--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local ScriptEditorService = game:GetService("ScriptEditorService")

return function(register)
	register("getScriptSource", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		if not inst:IsA("LuaSourceContainer") then error(args.path .. " is not a script") end
		return { source = inst.Source, className = inst.ClassName }
	end)

	register("setScriptSource", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		if not inst:IsA("LuaSourceContainer") then error(args.path .. " is not a script") end
		-- UpdateSourceAsync handles scripts open in the editor; fall back to direct set.
		local ok = pcall(function()
			ScriptEditorService:UpdateSourceAsync(inst, function()
				return args.source
			end)
		end)
		if not ok then
			inst.Source = args.source
		end
		return { ok = true }
	end)

	register("grepScripts", function(args)
		local pattern = args.pattern
		local ignoreCase = args.ignoreCase
		local matches = {}
		for _, d in ipairs(game:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				local ok, src = pcall(function() return d.Source end)
				if ok and src then
					local lineNo = 0
					for line in (src .. "\n"):gmatch("(.-)\n") do
						lineNo += 1
						local hay = ignoreCase and string.lower(line) or line
						local needle = ignoreCase and string.lower(pattern) or pattern
						if string.find(hay, needle) then
							table.insert(matches, { path = Serialize.uniquePath(d), line = lineNo, text = line })
							if #matches >= 500 then return { matches = matches } end
						end
					end
				end
			end
		end
		return { matches = matches }
	end)

	register("getScriptTree", function()
		local scripts = {}
		for _, d in ipairs(game:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				table.insert(scripts, { className = d.ClassName, path = Serialize.uniquePath(d) })
			end
		end
		return { scripts = scripts }
	end)

	-- Full pull: every script's path + class + source in one response, for the
	-- auto-mirror-on-connect flow. Skips plugin code.
	register("pullAll", function()
		local pluginDebug = game:FindFirstChild("PluginDebugService")
		local scripts = {}
		for _, d in ipairs(game:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				if pluginDebug and d:IsDescendantOf(pluginDebug) then
					continue
				end
				local ok, src = pcall(function() return d.Source end)
				if ok then
					table.insert(scripts, { studioPath = Serialize.uniquePath(d), className = d.ClassName, source = src })
				end
			end
		end
		return { scripts = scripts }
	end)

	-- Line-range edit primitive. Replaces lines [startLine..endLine] (1-indexed,
	-- inclusive) with newText. Backs edit/insert/delete:
	--   replace : startLine..endLine -> newText
	--   insert  : endLine = startLine-1 (empty range) -> newText before startLine
	--   delete  : newText = "" / nil
	-- Avoids re-sending the whole source for small changes (faster, less clobber).
	register("editScriptLines", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		if not inst:IsA("LuaSourceContainer") then error(args.path .. " is not a script") end

		local lines = {}
		for line in (inst.Source .. "\n"):gmatch("(.-)\n") do
			table.insert(lines, line)
		end
		local total = #lines

		local s = args.startLine or 1
		local e = args.endLine
		if e == nil then e = s - 1 end -- pure insertion before startLine
		if s < 1 then s = 1 end
		if e > total then e = total end
		if e < s - 1 then e = s - 1 end

		local out = {}
		for i = 1, math.min(s - 1, total) do
			out[#out + 1] = lines[i]
		end
		if args.newText and args.newText ~= "" then
			for line in (args.newText .. "\n"):gmatch("(.-)\n") do
				out[#out + 1] = line
			end
		end
		for i = e + 1, total do
			out[#out + 1] = lines[i]
		end

		local newSrc = table.concat(out, "\n")
		local ok = pcall(function()
			ScriptEditorService:UpdateSourceAsync(inst, function() return newSrc end)
		end)
		if not ok then inst.Source = newSrc end
		return { ok = true, lineCount = #out }
	end)

	register("findAndReplace", function(args)
		-- args: find (plain text), replace, dryRun (bool)
		local find = args.find
		local replace = args.replace or ""
		local dryRun = args.dryRun
		local edits = {}
		for _, d in ipairs(game:GetDescendants()) do
			if d:IsA("LuaSourceContainer") then
				local ok, src = pcall(function() return d.Source end)
				if ok and src and string.find(src, find, 1, true) then
					-- plain (non-pattern) replace
					local newSrc, count = src:gsub(find:gsub("[%-%.%+%[%]%(%)%$%^%%%?%*]", "%%%1"), (replace:gsub("%%", "%%%%")))
					table.insert(edits, { path = Serialize.uniquePath(d), count = count })
					if not dryRun then
						local setOk = pcall(function()
							ScriptEditorService:UpdateSourceAsync(d, function() return newSrc end)
						end)
						if not setOk then d.Source = newSrc end
					end
				end
			end
		end
		return { dryRun = dryRun and true or false, edits = edits, scripts = #edits }
	end)

	-- patchScript: apply MANY anchored find/replace hunks to ONE script in a
	-- single call. Each hunk { find, replace, all?, optional? } is a literal
	-- (non-pattern) match applied in order. The patch is ATOMIC: if a required
	-- hunk's `find` is missing it errors BEFORE writing anything, so a stale patch
	-- can't half-apply or silently no-op. Refactor-grade editing without resending
	-- the whole file.
	register("patchScript", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		if not inst:IsA("LuaSourceContainer") then error(args.path .. " is not a script") end

		local hunks = args.hunks or {}
		local src = inst.Source
		local applied, results = 0, {}
		for i, h in ipairs(hunks) do
			local find = h.find or ""
			if find == "" or not string.find(src, find, 1, true) then
				if h.optional then
					results[i] = { applied = false, reason = "not found (optional)" }
				else
					error(string.format("hunk %d find not found (nothing written): %q", i, string.sub(find, 1, 80)))
				end
			else
				local pat = find:gsub("[%-%.%+%[%]%(%)%$%^%%%?%*]", "%%%1")
				local rep = (h.replace or ""):gsub("%%", "%%%%")
				local n
				if h.all then
					src, n = src:gsub(pat, rep)
				else
					src, n = src:gsub(pat, rep, 1)
				end
				applied += n
				results[i] = { applied = true, count = n }
			end
		end

		if not args.dryRun then
			local ok = pcall(function()
				ScriptEditorService:UpdateSourceAsync(inst, function() return src end)
			end)
			if not ok then inst.Source = src end
		end
		return { ok = true, hunks = results, replacements = applied, dryRun = args.dryRun and true or false }
	end)
end
