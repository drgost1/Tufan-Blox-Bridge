--!nocheck
local Serialize = require(script.Parent.Parent.Serialize.Instance)
local ScriptEditorService = game:GetService("ScriptEditorService")

return function(register)
	register("getScriptSource", function(args)
		local inst, err = Serialize.resolve(args.path)
		if not inst then error(err) end
		if not inst:IsA("LuaSourceContainer") then error(args.path .. " is not a script") end
		return { source = inst.Source }
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
							table.insert(matches, { path = d:GetFullName(), line = lineNo, text = line })
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
				table.insert(scripts, { className = d.ClassName, path = d:GetFullName() })
			end
		end
		return { scripts = scripts }
	end)
end
