--!nocheck
-- Aggregates every op handler into one dispatch table: op name -> function(args).

local function build(ctx)
	local dispatch = {}
	local function register(op, fn)
		dispatch[op] = fn
	end

	require(script.Scripts)(register, ctx)
	require(script.Instances)(register, ctx)
	require(script.Properties)(register, ctx)
	require(script.Tree)(register, ctx)
	require(script.Luau)(register, ctx)
	require(script.Logs)(register, ctx)
	require(script.Assets)(register, ctx)
	require(script.System)(register, ctx)
	require(script.Parent.Sync.Apply)(register, ctx)

	return dispatch
end

return build
