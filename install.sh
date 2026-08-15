#!/usr/bin/env bash
# Tufan-Blox-Bridge -- one-line installer (macOS / Linux).
#
#   cd <your Roblox project folder>
#   curl -fsSL https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.sh | bash
#
# What it does:
#   1. Checks Node.js >= 18
#   2. npm i -g tufan-blox-bridge
#   3. tufan-blox-bridge install-plugin   (Studio plugin -> ~/Documents/Roblox/Plugins on macOS)
#   4. Registers the MCP server with Claude Code (if the `claude` CLI is on PATH),
#      else prints ready-to-paste config for any MCP client.
set -euo pipefail

PROJECT_ROOT="${TUFAN_PROJECT:-$(pwd)}"
REPO="https://github.com/drgost1/Tufan-Blox-Bridge"

say()  { printf '\033[36m> %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m[!]\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m[X]\033[0m %s\n' "$1"; exit 1; }

echo
echo "  Tufan-Blox-Bridge installer"
echo "  $REPO"
echo

# --- 1. node >= 18 ---
say "Checking Node.js (need >= 18)"
command -v node >/dev/null 2>&1 || die "Node.js not found. Install from https://nodejs.org (LTS) and re-run."
NODE_VER="$(node --version)"
NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed 's/^v//' | cut -d. -f1)"
[ "${NODE_MAJOR:-0}" -ge 18 ] || die "Node.js $NODE_VER is too old -- the bridge needs >= 18."
ok "node $NODE_VER"

# --- 2. global server install ---
say "Installing the MCP server (npm i -g tufan-blox-bridge)"
npm i -g tufan-blox-bridge >/dev/null 2>&1 || die "npm i -g tufan-blox-bridge failed. Run it manually to see the error."
command -v tufan-blox-bridge >/dev/null 2>&1 || die "Install reported success but 'tufan-blox-bridge' isn't on PATH -- restart the terminal and re-run."
ok "tufan-blox-bridge on PATH"

# --- 3. Studio plugin ---
say "Installing the Studio plugin (tufan-blox-bridge install-plugin)"
if tufan-blox-bridge install-plugin; then
  ok "Studio plugin installed"
else
  warn "install-plugin failed -- if your globally installed version is old, update: npm i -g tufan-blox-bridge@latest"
  warn "Manual fallback: download TufanBloxBridge.rbxm from $REPO/releases/latest and drop it into your Studio Plugins folder"
fi

# --- 4. MCP client registration ---
say "Registering the MCP server"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove tufan >/dev/null 2>&1 || true
  claude mcp add tufan --env "TUFAN_PROJECT=$PROJECT_ROOT" -- tufan-blox-bridge >/dev/null 2>&1
  # Verify the command landed -- a dropped arg = silent 30s timeout later.
  if claude mcp get tufan 2>&1 | grep -q "tufan-blox-bridge"; then
    ok "Registered + verified with Claude Code (TUFAN_PROJECT=$PROJECT_ROOT)"
  else
    warn "MCP entry malformed (command didn't register). Fix manually:"
    echo "    claude mcp remove tufan"
    echo "    claude mcp add tufan --env TUFAN_PROJECT=$PROJECT_ROOT -- tufan-blox-bridge"
    echo "    (confirm: claude mcp get tufan)"
  fi
else
  warn "Claude Code CLI not found -- skipping auto-registration."
fi

echo
echo "  MCP client config (Cursor / Claude Desktop / any MCP client):"
echo '    {'
echo '      "mcpServers": {'
echo '        "tufan": {'
echo '          "command": "tufan-blox-bridge",'
echo "          \"env\": { \"TUFAN_PROJECT\": \"$PROJECT_ROOT\" }"
echo '        }'
echo '      }'
echo '    }'
echo "  Optional env: TUFAN_OPENCLOUD_KEY (Open Cloud: datastore / cloud_luau / server logs), TUFAN_MESHY_KEY (AI 3D generation)."
echo '  Alternative to the global install: "command": "npx", "args": ["-y", "tufan-blox-bridge"]'

echo
echo "  Done. Restart Studio (Tufan Studio toolbar) and your AI client."
echo
