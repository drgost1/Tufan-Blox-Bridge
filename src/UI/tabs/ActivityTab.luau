--!nocheck
-- ActivityTab — live scrolling feed. Appends incrementally on each push instead
-- of rebuilding the whole list (prevents UIListLayout race conditions when
-- events arrive in rapid bursts during plugin boot).

local ActivityTab = {}

local ROW_HEIGHT = 20

local function color(theme: StudioTheme, name: string): Color3
	local ok, c = pcall(function() return theme:GetColor(Enum.StudioStyleGuideColor[name]) end)
	if ok then return c end
	return Color3.new(1, 1, 1)
end

local function categoryColor(category: string): Color3
	if category == "argon" then return Color3.fromRGB(100, 220, 200) end
	if category == "mcp" then return Color3.fromRGB(160, 140, 255) end
	if category == "error" then return Color3.fromRGB(255, 100, 100) end
	if category == "system" then return Color3.fromRGB(180, 180, 180) end
	return Color3.fromRGB(140, 140, 140)
end

local function makeRow(event, layoutOrder: number): TextLabel
	local row = Instance.new("TextLabel")
	row.Name = "Row" .. tostring(layoutOrder)
	row.BackgroundTransparency = 1
	row.Size = UDim2.new(1, -8, 0, ROW_HEIGHT)
	row.LayoutOrder = layoutOrder
	row.Font = Enum.Font.Code
	row.TextSize = 12
	row.TextXAlignment = Enum.TextXAlignment.Left
	row.TextYAlignment = Enum.TextYAlignment.Center
	row.TextTruncate = Enum.TextTruncate.AtEnd
	row.TextWrapped = false
	row.RichText = false
	row.TextColor3 = categoryColor(event.category)

	local timestamp = os.date("%H:%M:%S", event.timestamp)
	row.Text = string.format("%s [%s] %s", timestamp, event.category, event.text)
	return row
end

function ActivityTab.create(parent: Instance, coordinator: any)
	local theme = settings().Studio.Theme

	local frame = Instance.new("Frame")
	frame.Name = "ActivityTab"
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = color(theme, "MainBackground")
	frame.BorderSizePixel = 0
	frame.Visible = false
	frame.Parent = parent

	-- Filter bar
	local filterBar = Instance.new("Frame")
	filterBar.Size = UDim2.new(1, 0, 0, 28)
	filterBar.BackgroundColor3 = color(theme, "Titlebar")
	filterBar.BorderSizePixel = 0
	filterBar.Parent = frame

	local filterLayout = Instance.new("UIListLayout", filterBar)
	filterLayout.FillDirection = Enum.FillDirection.Horizontal
	filterLayout.Padding = UDim.new(0, 4)
	filterLayout.SortOrder = Enum.SortOrder.LayoutOrder
	filterLayout.VerticalAlignment = Enum.VerticalAlignment.Center

	local filterPad = Instance.new("UIPadding", filterBar)
	filterPad.PaddingLeft = UDim.new(0, 8)

	-- Scroll area
	local scroll = Instance.new("ScrollingFrame")
	scroll.Size = UDim2.new(1, 0, 1, -28)
	scroll.Position = UDim2.fromOffset(0, 28)
	scroll.BackgroundTransparency = 1
	scroll.BorderSizePixel = 0
	scroll.ScrollBarThickness = 6
	scroll.CanvasSize = UDim2.fromScale(0, 0)
	scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scroll.ScrollingDirection = Enum.ScrollingDirection.Y
	scroll.Parent = frame

	local listLayout = Instance.new("UIListLayout", scroll)
	listLayout.SortOrder = Enum.SortOrder.LayoutOrder
	listLayout.Padding = UDim.new(0, 2)
	listLayout.HorizontalAlignment = Enum.HorizontalAlignment.Left
	listLayout.VerticalAlignment = Enum.VerticalAlignment.Top

	local scrollPadding = Instance.new("UIPadding", scroll)
	scrollPadding.PaddingLeft = UDim.new(0, 8)
	scrollPadding.PaddingTop = UDim.new(0, 4)
	scrollPadding.PaddingBottom = UDim.new(0, 4)

	local currentFilter: string? = nil
	local rowCounter = 0  -- monotonically increasing LayoutOrder so newer rows append after older ones
	local rowsByEvent = setmetatable({}, { __mode = "v" })  -- weak-value map of event-time -> row, for cleanup

	local function rowMatchesFilter(event): boolean
		if currentFilter == nil then return true end
		return event.category == currentFilter
	end

	local function appendRow(event)
		if not rowMatchesFilter(event) then return end
		rowCounter += 1
		local row = makeRow(event, rowCounter)
		row.Parent = scroll
		-- Trim — keep only last 200 visible rows to match feed buffer
		local rows = {}
		for _, child in ipairs(scroll:GetChildren()) do
			if child:IsA("TextLabel") then table.insert(rows, child) end
		end
		if #rows > 200 then
			table.sort(rows, function(a, b) return a.LayoutOrder < b.LayoutOrder end)
			for i = 1, #rows - 200 do rows[i]:Destroy() end
		end
	end

	local function rebuildFromSnapshot()
		for _, child in ipairs(scroll:GetChildren()) do
			if child:IsA("TextLabel") then child:Destroy() end
		end
		rowCounter = 0
		local events = coordinator.activityFeed:snapshot()
		for _, event in ipairs(events) do
			if rowMatchesFilter(event) then
				rowCounter += 1
				local row = makeRow(event, rowCounter)
				row.Parent = scroll
			end
		end
	end

	local function makeFilterButton(label, value, order)
		local btn = Instance.new("TextButton")
		btn.LayoutOrder = order
		btn.Size = UDim2.fromOffset(60, 20)
		btn.BackgroundColor3 = color(theme, "Button")
		btn.BorderSizePixel = 0
		btn.Font = Enum.Font.GothamMedium
		btn.TextSize = 11
		btn.TextColor3 = color(theme, "ButtonText")
		btn.AutoButtonColor = true
		btn.Text = label
		btn.Parent = filterBar
		local btnCorner = Instance.new("UICorner", btn)
		btnCorner.CornerRadius = UDim.new(0, 4)
		btn.Activated:Connect(function()
			currentFilter = value
			rebuildFromSnapshot()
		end)
		return btn
	end

	makeFilterButton("All", nil, 1)
	makeFilterButton("Argon", "argon", 2)
	makeFilterButton("MCP", "mcp", 3)
	makeFilterButton("Errors", "error", 4)
	makeFilterButton("System", "system", 5)

	-- Hydrate with whatever the feed already has
	rebuildFromSnapshot()

	-- Listen for new pushes — append incrementally
	coordinator.activityFeed:onPush(function(event)
		appendRow(event)
	end)

	return frame
end

return ActivityTab
