--!nocheck
-- AIDevTab — Phase C placeholder. Lockdown toggle, snapshot list, error summary.

local AIDevTab = {}

local function color(theme: StudioTheme, name: string): Color3
	local ok, c = pcall(function() return theme:GetColor(Enum.StudioStyleGuideColor[name]) end)
	if ok then return c end
	return Color3.new(1, 1, 1)
end

function AIDevTab.create(parent: Instance, _coordinator: any)
	local theme = settings().Studio.Theme

	local frame = Instance.new("Frame")
	frame.Name = "AIDevTab"
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = color(theme, "MainBackground")
	frame.BorderSizePixel = 0
	frame.Visible = false
	frame.Parent = parent

	local padding = Instance.new("UIPadding", frame)
	padding.PaddingTop = UDim.new(0, 12)
	padding.PaddingLeft = UDim.new(0, 12)
	padding.PaddingRight = UDim.new(0, 12)

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 1, 0)
	label.Font = Enum.Font.GothamMedium
	label.TextSize = 13
	label.TextWrapped = true
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.TextColor3 = color(theme, "DimmedText")
	label.Text = "AIDev (Phase C — placeholder)\n\n• Auto-snapshot before AI write\n• Error mirror to disk via Argon sync\n• Lockdown toggle (read-only MCP)\n• Playtest tracking\n\nThese arrive in the next phase."
	label.Parent = frame

	return frame
end

return AIDevTab
