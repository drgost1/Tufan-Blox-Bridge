--!nocheck
-- Time-sliced yielding for long loops. Studio runs every plugin on its main
-- thread, so a loop that walks a big place without handing a frame back freezes
-- the editor and, after a few seconds, raises "TufanBloxBridge.rbxm is not
-- responding — stop this plugin?". Counting iterations (yield every N) is not
-- enough: N cheap steps take microseconds, N script sources or N path builds can
-- take seconds. So the budget is wall-clock time.
--
--   local Yield = require(path.to.Util.Yield)
--   for _, d in ipairs(list) do
--       Yield.maybe()
--       ...
--   end
--
-- Only call it where yielding is legal: a normal thread (command handler, signal
-- handler, task.spawn). Never inside table.sort comparators, metamethods, or
-- callbacks Roblox runs without a thread (e.g. UpdateSourceAsync's transform).

local Yield = {}

local SLICE_SECONDS = 0.008 -- work per frame before handing control back

-- One slice clock per thread: a thread that just resumed starts a fresh slice,
-- and one busy thread never makes another thread yield early.
local sliceStart = setmetatable({}, { __mode = "k" })

function Yield.maybe()
	local thread = coroutine.running()
	local now = os.clock()
	local started = sliceStart[thread]
	if started == nil then
		sliceStart[thread] = now
	elseif now - started > SLICE_SECONDS then
		task.wait()
		sliceStart[thread] = os.clock()
	end
end

-- Start a fresh slice now (call before a loop that follows other heavy work).
function Yield.reset()
	sliceStart[coroutine.running()] = os.clock()
end

return Yield
