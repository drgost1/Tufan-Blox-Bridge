--!nocheck
-- Toolbar — single button on a "Tufan Studio" toolbar that toggles the main widget.

local Toolbar = {}

local TOOLBAR_NAME = "Tufan Studio"
local BUTTON_TOOLTIP = "Open Tufan-Blox-Bridge — Argon sync + MCP AI tools"
local BUTTON_TEXT = "Tufan-Blox-Bridge"
-- Empty string = no icon, no asset-load failure. Custom Tufan icon comes later.
local BUTTON_ICON = ""

function Toolbar.create(plugin: Plugin, onClick: () -> ())
	local toolbar = plugin:CreateToolbar(TOOLBAR_NAME)
	local button = toolbar:CreateButton(
		"tufan_blox_bridge_button",
		BUTTON_TOOLTIP,
		BUTTON_ICON,
		BUTTON_TEXT
	)
	button.ClickableWhenViewportHidden = true
	button.Click:Connect(onClick)
	return toolbar, button
end

return Toolbar
