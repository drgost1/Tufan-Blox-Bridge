--!nocheck
-- Toolbar + dockable widget. Git/GitHub is a MASTER opt-in toggle (off by default,
-- persisted): when off, all git controls are disabled — no repo, no headache. When
-- on, the auto toggles + Commit/Push/Backup/Setup-GitHub light up. All toggles
-- persist across Studio restarts (via Settings) and sync to the server.

local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Net.Config)

local UI = {}

local function color(theme, name)
	local ok, c = pcall(function() return theme:GetColor(Enum.StudioStyleGuideColor[name]) end)
	return ok and c or Color3.new(1, 1, 1)
end

function UI.start(plugin, ctx)
	local theme = settings().Studio.Theme
	local S = ctx and ctx.settings -- persisted settings (gitEnabled/autoCommit/autoPush)

	local toolbar = plugin:CreateToolbar("Tufan Studio")
	local button = toolbar:CreateButton("tufan_blox_bridge", "Open Tufan-Blox-Bridge", "", "Tufan-Blox-Bridge")
	button.ClickableWhenViewportHidden = true

	local widget = plugin:CreateDockWidgetPluginGui(
		"tufan_blox_bridge_widget",
		DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 380, 440, 340, 320)
	)
	widget.Title = "Tufan-Blox-Bridge"
	widget.Name = "TufanBloxBridge"

	local api = {}
	local state = {
		gitEnabled = S and S:get("gitEnabled") or false,
		autoCommit = S and S:get("autoCommit") or false,
		autoPush = S and S:get("autoPush") or false,
	}

	-- ── Header ──────────────────────────────────────────────────────────────
	local header = Instance.new("Frame")
	header.Size = UDim2.new(1, 0, 0, 56)
	header.BackgroundColor3 = color(theme, "Titlebar")
	header.BorderSizePixel = 0
	header.Parent = widget

	local pill = Instance.new("Frame")
	pill.Size = UDim2.fromOffset(90, 22)
	pill.Position = UDim2.fromOffset(10, 8)
	pill.BackgroundColor3 = Color3.fromRGB(255, 159, 10)
	pill.BorderSizePixel = 0
	pill.Parent = header
	Instance.new("UICorner", pill).CornerRadius = UDim.new(0, 11)

	local pillLabel = Instance.new("TextLabel")
	pillLabel.Size = UDim2.fromScale(1, 1)
	pillLabel.BackgroundTransparency = 1
	pillLabel.Font = Enum.Font.GothamMedium
	pillLabel.TextSize = 12
	pillLabel.TextColor3 = Color3.new(1, 1, 1)
	pillLabel.Text = "connecting"
	pillLabel.Parent = pill

	local meta = Instance.new("TextLabel")
	meta.Size = UDim2.new(1, -110, 0, 40)
	meta.Position = UDim2.fromOffset(108, 8)
	meta.BackgroundTransparency = 1
	meta.Font = Enum.Font.Code
	meta.TextSize = 11
	meta.TextXAlignment = Enum.TextXAlignment.Left
	meta.TextYAlignment = Enum.TextYAlignment.Top
	meta.TextColor3 = color(theme, "DimmedText")
	meta.Text = "server: 127.0.0.1:58741\nsession: —"
	meta.Parent = header

	-- ── Activity feed (defined early so handlers can log) ───────────────────
	local scroll = Instance.new("ScrollingFrame")
	scroll.Size = UDim2.new(1, 0, 1, -170)
	scroll.Position = UDim2.fromOffset(0, 170)
	scroll.BackgroundColor3 = color(theme, "MainBackground")
	scroll.BorderSizePixel = 0
	scroll.ScrollBarThickness = 6
	scroll.CanvasSize = UDim2.fromScale(0, 0)
	scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scroll.Parent = widget
	local listLayout = Instance.new("UIListLayout", scroll)
	listLayout.SortOrder = Enum.SortOrder.LayoutOrder
	listLayout.Padding = UDim.new(0, 1)
	local pad = Instance.new("UIPadding", scroll)
	pad.PaddingLeft = UDim.new(0, 8)
	pad.PaddingTop = UDim.new(0, 4)

	local rowOrder = 0
	function api.pushActivity(msg)
		rowOrder += 1
		local row = Instance.new("TextLabel")
		row.LayoutOrder = rowOrder
		row.Size = UDim2.new(1, -8, 0, 16)
		row.BackgroundTransparency = 1
		row.Font = Enum.Font.Code
		row.TextSize = 11
		row.TextXAlignment = Enum.TextXAlignment.Left
		row.TextTruncate = Enum.TextTruncate.AtEnd
		row.TextColor3 = color(theme, "MainText")
		row.Text = string.format("%s  %s", os.date("%H:%M:%S"), msg)
		row.Parent = scroll
		local rows = {}
		for _, c in ipairs(scroll:GetChildren()) do
			if c:IsA("TextLabel") then table.insert(rows, c) end
		end
		if #rows > 200 then
			table.sort(rows, function(a, b) return a.LayoutOrder < b.LayoutOrder end)
			rows[1]:Destroy()
		end
	end

	-- Send the full settings snapshot to the server.
	local function postConfig()
		pcall(function()
			HttpService:RequestAsync({
				Url = Config.serverUrl .. "/config",
				Method = "POST",
				Headers = { ["Content-Type"] = "application/json" },
				Body = HttpService:JSONEncode({
					gitEnabled = state.gitEnabled,
					autoCommit = state.autoCommit,
					autoPush = state.autoPush,
				}),
			})
		end)
	end

	-- POST an action to the bridge (with this session) and log the result.
	local function postAction(path, body, label)
		task.spawn(function()
			body = body or {}
			body.sessionId = ctx and ctx.sessionId
			local ok, res = pcall(function()
				return HttpService:RequestAsync({
					Url = Config.serverUrl .. path,
					Method = "POST",
					Headers = { ["Content-Type"] = "application/json" },
					Body = HttpService:JSONEncode(body),
				})
			end)
			if ok and res and res.Body then
				local okD, d = pcall(function() return HttpService:JSONDecode(res.Body) end)
				if okD and type(d) == "table" then
					api.pushActivity((d.ok and "✓ " or "✗ ") .. label .. ": " .. tostring(d.message or d.error or "done"))
					return
				end
			end
			api.pushActivity("✗ " .. label .. ": server unreachable")
		end)
	end

	-- Git-gated controls dim + stop responding when git is off.
	local gated = {}
	local function refreshGating()
		for _, btn in ipairs(gated) do
			btn.AutoButtonColor = state.gitEnabled
			btn.BackgroundTransparency = state.gitEnabled and 0 or 0.6
			btn.TextTransparency = state.gitEnabled and 0 or 0.45
		end
	end

	-- ── Master Git toggle (row 1) ───────────────────────────────────────────
	local masterRow = Instance.new("Frame")
	masterRow.Size = UDim2.new(1, 0, 0, 26)
	masterRow.Position = UDim2.fromOffset(0, 56)
	masterRow.BackgroundColor3 = color(theme, "Titlebar")
	masterRow.BorderSizePixel = 0
	masterRow.Parent = widget

	local master = Instance.new("TextButton")
	master.Size = UDim2.new(1, -12, 0, 20)
	master.Position = UDim2.fromOffset(6, 3)
	master.BorderSizePixel = 0
	master.Font = Enum.Font.GothamBold
	master.TextSize = 12
	master.Parent = masterRow
	Instance.new("UICorner", master).CornerRadius = UDim.new(0, 4)
	local function renderMaster()
		master.Text = state.gitEnabled and "🔒 Git & GitHub: ON  (click to disable)" or "Enable Git & GitHub  (off — opt-in)"
		master.BackgroundColor3 = state.gitEnabled and Color3.fromRGB(45, 51, 59) or color(theme, "Button")
		master.TextColor3 = state.gitEnabled and Color3.new(1, 1, 1) or color(theme, "ButtonText")
	end
	master.Activated:Connect(function()
		state.gitEnabled = not state.gitEnabled
		if S then S:set("gitEnabled", state.gitEnabled) end
		renderMaster()
		refreshGating()
		postConfig()
		api.pushActivity(state.gitEnabled
			and "✓ Git enabled — Commit / Backup / Setup GitHub available (persists next session)"
			or "Git disabled — no repo, no commits. File sync still works.")
	end)

	-- ── Auto toggles (row 2) ────────────────────────────────────────────────
	local gitBar = Instance.new("Frame")
	gitBar.Size = UDim2.new(1, 0, 0, 26)
	gitBar.Position = UDim2.fromOffset(0, 82)
	gitBar.BackgroundColor3 = color(theme, "Titlebar")
	gitBar.BorderSizePixel = 0
	gitBar.Parent = widget

	local function makeToggle(label, key, x)
		local btn = Instance.new("TextButton")
		btn.Size = UDim2.fromOffset(160, 20)
		btn.Position = UDim2.fromOffset(x, 3)
		btn.BorderSizePixel = 0
		btn.Font = Enum.Font.GothamMedium
		btn.TextSize = 11
		btn.Parent = gitBar
		Instance.new("UICorner", btn).CornerRadius = UDim.new(0, 4)
		local function render()
			btn.Text = label .. ": " .. (state[key] and "ON" or "OFF")
			btn.BackgroundColor3 = state[key] and Color3.fromRGB(52, 199, 89) or color(theme, "Button")
			btn.TextColor3 = state[key] and Color3.new(1, 1, 1) or color(theme, "ButtonText")
		end
		btn.Activated:Connect(function()
			if not state.gitEnabled then
				api.pushActivity("enable Git first (master toggle above)")
				return
			end
			state[key] = not state[key]
			if S then S:set(key, state[key]) end
			render()
			postConfig()
		end)
		render()
		table.insert(gated, btn)
		return btn
	end
	makeToggle("Auto-commit", "autoCommit", 8)
	makeToggle("Auto-push", "autoPush", 176)

	-- ── Action buttons (row 3) ──────────────────────────────────────────────
	local actions = Instance.new("Frame")
	actions.Size = UDim2.new(1, 0, 0, 26)
	actions.Position = UDim2.fromOffset(0, 108)
	actions.BackgroundColor3 = color(theme, "Titlebar")
	actions.BorderSizePixel = 0
	actions.Parent = widget
	local aLayout = Instance.new("UIListLayout", actions)
	aLayout.FillDirection = Enum.FillDirection.Horizontal
	aLayout.Padding = UDim.new(0, 4)
	aLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	local aPad = Instance.new("UIPadding", actions)
	aPad.PaddingLeft = UDim.new(0, 6)

	local function makeAction(label, bg, fn, isGated)
		local b = Instance.new("TextButton")
		b.Size = UDim2.fromOffset(82, 21)
		b.BackgroundColor3 = bg
		b.TextColor3 = Color3.new(1, 1, 1)
		b.Font = Enum.Font.GothamMedium
		b.TextSize = 11
		b.Text = label
		b.BorderSizePixel = 0
		b.Parent = actions
		Instance.new("UICorner", b).CornerRadius = UDim.new(0, 4)
		b.Activated:Connect(function()
			if isGated and not state.gitEnabled then
				api.pushActivity("enable Git first (master toggle above)")
				return
			end
			fn()
		end)
		if isGated then table.insert(gated, b) end
		return b
	end
	makeAction("Commit now", Color3.fromRGB(52, 120, 246), function() postAction("/git/commit", {}, "commit") end, true)
	makeAction("Push now", Color3.fromRGB(88, 86, 214), function() postAction("/git/push", {}, "push") end, true)
	makeAction("Backup", Color3.fromRGB(52, 199, 89), function() postAction("/git/backup", {}, "backup") end, true)
	makeAction("Re-pull", color(theme, "Button"), function() postAction("/git/repull", {}, "re-pull") end, false) -- sync, not git

	-- ── GitHub setup (row 4) ────────────────────────────────────────────────
	local ghRow = Instance.new("Frame")
	ghRow.Size = UDim2.new(1, 0, 0, 32)
	ghRow.Position = UDim2.fromOffset(0, 134)
	ghRow.BackgroundColor3 = color(theme, "Titlebar")
	ghRow.BorderSizePixel = 0
	ghRow.Parent = widget

	local urlBox = Instance.new("TextBox")
	urlBox.Size = UDim2.new(1, -104, 0, 22)
	urlBox.Position = UDim2.fromOffset(6, 5)
	urlBox.PlaceholderText = "github repo URL (https://github.com/you/repo.git)"
	urlBox.Text = ""
	urlBox.ClearTextOnFocus = false
	urlBox.Font = Enum.Font.Code
	urlBox.TextSize = 11
	urlBox.TextXAlignment = Enum.TextXAlignment.Left
	urlBox.TextColor3 = color(theme, "MainText")
	urlBox.PlaceholderColor3 = color(theme, "DimmedText")
	urlBox.BackgroundColor3 = color(theme, "InputFieldBackground")
	urlBox.BorderColor3 = color(theme, "InputFieldBorder")
	urlBox.Parent = ghRow
	Instance.new("UICorner", urlBox).CornerRadius = UDim.new(0, 4)
	local uPad = Instance.new("UIPadding", urlBox)
	uPad.PaddingLeft = UDim.new(0, 6)

	local ghBtn = Instance.new("TextButton")
	ghBtn.Size = UDim2.fromOffset(90, 22)
	ghBtn.Position = UDim2.new(1, -96, 0, 5)
	ghBtn.Text = "Setup GitHub"
	ghBtn.Font = Enum.Font.GothamMedium
	ghBtn.TextSize = 11
	ghBtn.TextColor3 = Color3.new(1, 1, 1)
	ghBtn.BackgroundColor3 = Color3.fromRGB(45, 51, 59)
	ghBtn.BorderSizePixel = 0
	ghBtn.Parent = ghRow
	Instance.new("UICorner", ghBtn).CornerRadius = UDim.new(0, 4)
	ghBtn.Activated:Connect(function()
		if not state.gitEnabled then
			api.pushActivity("enable Git first (master toggle above)")
			return
		end
		local url = (urlBox.Text or ""):gsub("%s+", "")
		if url == "" then
			api.pushActivity("✗ setup github: enter a repo URL first")
			return
		end
		postAction("/git/remote", { url = url }, "setup github")
	end)
	table.insert(gated, ghBtn)

	renderMaster()
	refreshGating()

	-- ── Toolbar toggle + status ─────────────────────────────────────────────
	button.Click:Connect(function()
		widget.Enabled = not widget.Enabled
		button:SetActive(widget.Enabled)
	end)
	widget:GetPropertyChangedSignal("Enabled"):Connect(function()
		button:SetActive(widget.Enabled)
	end)

	function api.setStatus(connected, sessionId)
		pill.BackgroundColor3 = connected and Color3.fromRGB(52, 199, 89) or Color3.fromRGB(255, 69, 58)
		pillLabel.Text = connected and "connected" or "offline"
		meta.Text = string.format("server: 127.0.0.1:58741\nsession: %s", sessionId and string.sub(sessionId, 1, 8) or "—")
	end

	return api
end

return UI
