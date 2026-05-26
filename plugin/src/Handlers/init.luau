--!nocheck
-- Aggregates every op handler into one dispatch table: op name -> function(args).

local function build(ctx)
	local dispatch = {}
	local function register(op, fn)
		dispatch[op] = fn
	end

	-- Fault-tolerant module load: if one handler module fails to compile/run, warn
	-- and keep going so the plugin STILL boots + connects with every other tool.
	-- (A bad module no longer bricks the whole bridge.)
	local function load(name, mod, ...)
		-- pcall the require itself so a COMPILE error in the module is caught too
		-- (require(mod) would otherwise throw before pcall could protect it).
		local okReq, fn = pcall(require, mod)
		if not okReq then
			warn("[TufanBloxBridge] handler '" .. name .. "' failed to compile: " .. tostring(fn))
			return
		end
		local ok, err = pcall(fn, register, ctx, ...)
		if not ok then
			warn("[TufanBloxBridge] handler '" .. name .. "' failed to run: " .. tostring(err))
		end
	end

	load("Scripts", script.Scripts)
	load("Instances", script.Instances)
	load("Properties", script.Properties)
	load("Tree", script.Tree)
	load("Luau", script.Luau)
	load("Logs", script.Logs)
	load("Assets", script.Assets)
	load("System", script.System)
	load("Selection", script.Selection)
	load("Tags", script.Tags)
	load("Security", script.Security)
	load("Perf", script.Perf)
	load("Describe", script.Describe)
	load("Snapshot", script.Snapshot)
	load("Playtest", script.Playtest)
	load("Apply", script.Parent.Sync.Apply)

	-- batch must come last: it dispatches through the fully-built table.
	load("Batch", script.Batch, dispatch)

	return dispatch
end

return build
