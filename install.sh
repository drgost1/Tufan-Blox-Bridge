#!/usr/bin/env bash
# Tufan-Blox-Bridge — one-line installer (macOS / Linux).
#
#   cd <your Roblox project folder>
#   curl -fsSL https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.sh | bash
#
# Installs the Studio plugin and registers the MCP server with Claude Code.
# The server runs on demand via `npx -y tufan-blox-bridge` (no global install).
set -euo pipefail

PROJECT_ROOT="${TUFAN_PROJECT:-$(pwd)}"
REPO="https://github.com/drgost1/Tufan-Blox-Bridge"

say()  { printf '\033[36m> %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m[!]\033[0m %s\n' "$1"; }

echo
echo "  Tufan-Blox-Bridge installer"
echo "  $REPO"
echo

# Plugins dir (macOS vs Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLUGINS_DIR="$HOME/Documents/Roblox/Plugins"
else
  PLUGINS_DIR="$HOME/.local/share/Roblox/Plugins" # Wine/Sober paths vary; adjust if needed
fi

say "Checking prerequisites"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || warn "Node.js not found — needed to run the server via npx (https://nodejs.org)"

say "Installing Studio plugin"
mkdir -p "$PLUGINS_DIR"
PLUGIN_PATH="$PLUGINS_DIR/TufanBloxBridge.rbxm"
if ! curl -fsSL "$REPO/releases/latest/download/TufanBloxBridge.rbxm" -o "$PLUGIN_PATH" 2>/dev/null; then
  warn "No release asset yet — using main branch build."
  curl -fsSL "$REPO/raw/main/TufanBloxBridge.rbxm" -o "$PLUGIN_PATH"
fi
ok "Installed $PLUGIN_PATH"

say "Registering MCP server with Claude Code"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove tufan >/dev/null 2>&1 || true
  claude mcp add tufan --env "TUFAN_PROJECT=$PROJECT_ROOT" -- npx -y tufan-blox-bridge >/dev/null 2>&1
  ok "Registered: npx -y tufan-blox-bridge (TUFAN_PROJECT=$PROJECT_ROOT)"
else
  warn "Claude Code CLI not found. Add manually:"
  echo "    claude mcp add tufan --env TUFAN_PROJECT=$PROJECT_ROOT -- npx -y tufan-blox-bridge"
fi

echo
echo "  Done. Restart Studio (Tufan Studio toolbar) and your AI client."
echo
