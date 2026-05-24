--!nocheck
-- UI — orchestrates Toolbar + Widget. Owns the visibility toggle wiring.

local Widget = require(script.Widget)

local UI = {}

local TOOLBAR_NAME = "Tufan Studio"
local BUTTON_ID = "tufan_blox_bridge_button"
local BUTTON_TOOLTIP = "Open Tufan-Blox-Bridge — Argon sync + MCP AI tools"
local BUTTON_TEXT = "Tufan-Blox-Bridge"
local BUTTON_ICON = ""

function UI.start(plugin: Plugin, coordinator: any)
	local widget = Widget.create(plugin, coordinator)
	widget.Enabled = false

	local toolbar = plugin:CreateToolbar(TOOLBAR_NAME)
	local button = toolbar:CreateButton(BUTTON_ID, BUTTON_TOOLTIP, BUTTON_ICON, BUTTON_TEXT)
	button.ClickableWhenViewportHidden = true

	button.Click:Connect(function()
		widget.Enabled = not widget.Enabled
	end)

	widget:GetPropertyChangedSignal("Enabled"):Connect(function()
		button:SetActive(widget.Enabled)
	end)

	return widget
end

return UI
