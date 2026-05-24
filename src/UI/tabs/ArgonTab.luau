--!nocheck
-- ArgonTab — port, status, latency for Argon CLI.

local ArgonTab = {}

local function color(theme: StudioTheme, name: string): Color3
	local ok, c = pcall(function()
		return theme:GetColor(Enum.StudioStyleGuideColor[name])
	end)
	if ok then return c end
	return Color3.new(1, 1, 1)
end

local function statusColor(status: string): Color3
	if status == "ok" then return Color3.fromRGB(52, 199, 89) end
	if status == "down" then return Color3.fromRGB(255, 69, 58) end
	return Color3.fromRGB(255, 159, 10)
end

function ArgonTab.create(parent: Instance, coordinator: any)
	local theme = settings().Studio.Theme

	local frame = Instance.new("Frame")
	frame.Name = "ArgonTab"
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = color(theme, "MainBackground")
	frame.BorderSizePixel = 0
	frame.Visible = false
	frame.Parent = parent

	local padding = Instance.new("UIPadding", frame)
	padding.PaddingTop = UDim.new(0, 12)
	padding.PaddingLeft = UDim.new(0, 12)
	padding.PaddingRight = UDim.new(0, 12)

	local layout = Instance.new("UIListLayout", frame)
	layout.Padding = UDim.new(0, 8)
	layout.SortOrder = Enum.SortOrder.LayoutOrder

	local title = Instance.new("TextLabel")
	title.LayoutOrder = 1
	title.BackgroundTransparency = 1
	title.Size = UDim2.new(1, 0, 0, 24)
	title.Font = Enum.Font.GothamBold
	title.TextSize = 14
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextColor3 = color(theme, "MainText")
	title.Text = "Argon CLI"
	title.Parent = frame

	local pill = Instance.new("Frame")
	pill.LayoutOrder = 2
	pill.Size = UDim2.new(0, 100, 0, 24)
	pill.BackgroundColor3 = statusColor("unknown")
	pill.BorderSizePixel = 0
	pill.Parent = frame
	local pillCorner = Instance.new("UICorner", pill)
	pillCorner.CornerRadius = UDim.new(0, 12)
	local pillLabel = Instance.new("TextLabel")
	pillLabel.BackgroundTransparency = 1
	pillLabel.Size = UDim2.fromScale(1, 1)
	pillLabel.Font = Enum.Font.GothamMedium
	pillLabel.TextSize = 12
	pillLabel.TextColor3 = Color3.new(1, 1, 1)
	pillLabel.Text = "unknown"
	pillLabel.Parent = pill

	local meta = Instance.new("TextLabel")
	meta.LayoutOrder = 3
	meta.BackgroundTransparency = 1
	meta.Size = UDim2.new(1, 0, 0, 60)
	meta.Font = Enum.Font.Code
	meta.TextSize = 12
	meta.TextXAlignment = Enum.TextXAlignment.Left
	meta.TextYAlignment = Enum.TextYAlignment.Top
	meta.TextWrapped = true
	meta.TextColor3 = color(theme, "DimmedText")
	meta.Text = "endpoint: http://127.0.0.1:34872\nlast latency: —"
	meta.Parent = frame

	local function refresh()
		local snap = coordinator.healthCheck:snapshot()
		pill.BackgroundColor3 = statusColor(snap.argon)
		pillLabel.Text = snap.argon
		meta.Text = string.format(
			"endpoint: http://127.0.0.1:34872\nlast latency: %d ms",
			snap.argonLatencyMs
		)
	end
	refresh()
	coordinator.healthCheck:onChange(refresh)

	return frame
end

return ArgonTab
