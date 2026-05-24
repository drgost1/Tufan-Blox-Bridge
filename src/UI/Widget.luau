--!nocheck
-- Widget — the DockWidgetPluginGui that hosts the tabbed UI.

local ArgonTab = require(script.Parent.tabs.ArgonTab)
local MCPTab = require(script.Parent.tabs.MCPTab)
local ActivityTab = require(script.Parent.tabs.ActivityTab)
local AIDevTab = require(script.Parent.tabs.AIDevTab)

local Widget = {}

local function color(theme: StudioTheme, name: string): Color3
	local ok, c = pcall(function() return theme:GetColor(Enum.StudioStyleGuideColor[name]) end)
	if ok then return c end
	return Color3.new(1, 1, 1)
end

function Widget.create(plugin: Plugin, coordinator: any)
	local theme = settings().Studio.Theme

	local info = DockWidgetPluginGuiInfo.new(
		Enum.InitialDockState.Float,
		false,  -- start enabled
		false,  -- override existing
		420,    -- default width
		300,    -- default height
		320,    -- min width
		220     -- min height
	)
	local widget = plugin:CreateDockWidgetPluginGui("tufan_blox_bridge_widget", info)
	widget.Title = "Tufan-Blox-Bridge"
	widget.Name = "TufanBloxBridgeWidget"

	-- Tab bar at the top
	local tabBar = Instance.new("Frame")
	tabBar.Size = UDim2.new(1, 0, 0, 32)
	tabBar.BackgroundColor3 = color(theme, "Titlebar")
	tabBar.BorderSizePixel = 0
	tabBar.Parent = widget

	local tabBarLayout = Instance.new("UIListLayout", tabBar)
	tabBarLayout.FillDirection = Enum.FillDirection.Horizontal
	tabBarLayout.SortOrder = Enum.SortOrder.LayoutOrder
	tabBarLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	tabBarLayout.Padding = UDim.new(0, 2)

	local tabBarPadding = Instance.new("UIPadding", tabBar)
	tabBarPadding.PaddingLeft = UDim.new(0, 6)

	-- Content area
	local content = Instance.new("Frame")
	content.Size = UDim2.new(1, 0, 1, -32)
	content.Position = UDim2.fromOffset(0, 32)
	content.BackgroundColor3 = color(theme, "MainBackground")
	content.BorderSizePixel = 0
	content.Parent = widget

	local tabs = {
		{ id = "argon", label = "Argon", create = ArgonTab.create },
		{ id = "mcp", label = "MCP", create = MCPTab.create },
		{ id = "activity", label = "Activity", create = ActivityTab.create },
		{ id = "aidev", label = "AI Dev", create = AIDevTab.create },
	}

	local tabFrames = {}
	local tabButtons = {}

	local function showTab(targetId: string)
		for id, frame in pairs(tabFrames) do
			frame.Visible = (id == targetId)
		end
		for id, btn in pairs(tabButtons) do
			if id == targetId then
				btn.BackgroundColor3 = color(theme, "MainBackground")
				btn.TextColor3 = color(theme, "MainText")
			else
				btn.BackgroundColor3 = color(theme, "Button")
				btn.TextColor3 = color(theme, "DimmedText")
			end
		end
	end

	for i, tab in ipairs(tabs) do
		local btn = Instance.new("TextButton")
		btn.LayoutOrder = i
		btn.Size = UDim2.fromOffset(78, 24)
		btn.BackgroundColor3 = color(theme, "Button")
		btn.BorderSizePixel = 0
		btn.Font = Enum.Font.GothamMedium
		btn.TextSize = 12
		btn.TextColor3 = color(theme, "DimmedText")
		btn.Text = tab.label
		btn.Parent = tabBar
		local btnCorner = Instance.new("UICorner", btn)
		btnCorner.CornerRadius = UDim.new(0, 4)
		btn.Activated:Connect(function() showTab(tab.id) end)
		tabButtons[tab.id] = btn

		local frame = tab.create(content, coordinator)
		tabFrames[tab.id] = frame
	end

	showTab("argon")

	return widget
end

return Widget
