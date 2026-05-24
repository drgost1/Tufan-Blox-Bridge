--!nocheck
-- Toolbar + dockable status/activity widget (with git toggle switches).

local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Net.Config)

local UI = {}

local function color(theme, name)
	local ok, c = pcall(function() return theme:GetColor(Enum.StudioStyleGuideColor[name]) end)
	return ok and c or Color3.new(1, 1, 1)
end

function UI.start(plugin)
	local theme = settings().Studio.Theme

	local toolbar = plugin:CreateToolbar("Tufan Studio")
	local button = toolbar:CreateButton(
		"tufan_blox_bridge",
		"Open Tufan-Blox-Bridge",
		"",
		"Tufan-Blox-Bridge"
	)
	button.ClickableWhenViewportHidden = true

	local widget = plugin:CreateDockWidgetPluginGui(
		"tufan_blox_bridge_widget",
		DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 360, 280, 300, 200)
	)
	widget.Title = "Tufan-Blox-Bridge"
	widget.Name = "TufanBloxBridge"

	-- Header: status pill + meta
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

	-- Git toggle bar
	local gitBar = Instance.new("Frame")
	gitBar.Size = UDim2.new(1, 0, 0, 30)
	gitBar.Position = UDim2.fromOffset(0, 56)
	gitBar.BackgroundColor3 = color(theme, "Titlebar")
	gitBar.BorderSizePixel = 0
	gitBar.Parent = widget

	local gitState = { autoCommit = false, autoPush = false }
	local function postConfig()
		pcall(function()
			HttpService:RequestAsync({
				Url = Config.serverUrl .. "/config",
				Method = "POST",
				Headers = { ["Content-Type"] = "application/json" },
				Body = HttpService:JSONEncode(gitState),
			})
		end)
	end

	local function makeToggle(label, key, x)
		local btn = Instance.new("TextButton")
		btn.Size = UDim2.fromOffset(160, 22)
		btn.Position = UDim2.fromOffset(x, 4)
		btn.BorderSizePixel = 0
		btn.Font = Enum.Font.GothamMedium
		btn.TextSize = 11
		btn.Parent = gitBar
		Instance.new("UICorner", btn).CornerRadius = UDim.new(0, 4)
		local function render()
			btn.Text = label .. ": " .. (gitState[key] and "ON" or "OFF")
			btn.BackgroundColor3 = gitState[key] and Color3.fromRGB(52, 199, 89) or color(theme, "Button")
			btn.TextColor3 = gitState[key] and Color3.new(1, 1, 1) or color(theme, "ButtonText")
		end
		btn.Activated:Connect(function()
			gitState[key] = not gitState[key]
			render()
			postConfig()
		end)
		render()
		return btn
	end

	makeToggle("Auto-commit", "autoCommit", 8)
	makeToggle("Auto-push", "autoPush", 176)

	-- reflect server's current config on open
	task.spawn(function()
		local ok, res = pcall(function()
			return HttpService:RequestAsync({ Url = Config.serverUrl .. "/config", Method = "GET" })
		end)
		if ok and res.Success then
			local cfg = HttpService:JSONDecode(res.Body)
			gitState.autoCommit = cfg.autoCommit or false
			gitState.autoPush = cfg.autoPush or false
			for _, b in ipairs(gitBar:GetChildren()) do
				if b:IsA("TextButton") then
					b.Text = b.Text:gsub(":.*", ": " .. ((b.Text:find("commit") and gitState.autoCommit or gitState.autoPush) and "ON" or "OFF"))
				end
			end
		end
	end)

	-- Activity feed
	local scroll = Instance.new("ScrollingFrame")
	scroll.Size = UDim2.new(1, 0, 1, -86)
	scroll.Position = UDim2.fromOffset(0, 86)
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

	button.Click:Connect(function()
		widget.Enabled = not widget.Enabled
		button:SetActive(widget.Enabled)
	end)
	widget:GetPropertyChangedSignal("Enabled"):Connect(function()
		button:SetActive(widget.Enabled)
	end)

	local api = {}

	function api.setStatus(connected, sessionId)
		pill.BackgroundColor3 = connected and Color3.fromRGB(52, 199, 89) or Color3.fromRGB(255, 69, 58)
		pillLabel.Text = connected and "connected" or "offline"
		meta.Text = string.format("server: 127.0.0.1:58741\nsession: %s", sessionId and string.sub(sessionId, 1, 8) or "—")
	end

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
		-- trim to last 200
		local rows = {}
		for _, c in ipairs(scroll:GetChildren()) do
			if c:IsA("TextLabel") then table.insert(rows, c) end
		end
		if #rows > 200 then
			table.sort(rows, function(a, b) return a.LayoutOrder < b.LayoutOrder end)
			rows[1]:Destroy()
		end
	end

	return api
end

return UI
