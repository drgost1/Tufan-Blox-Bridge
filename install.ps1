# Tufan-Blox-Bridge — one-line installer (Windows PowerShell 5.1+ or PowerShell 7).
#
#   cd <your Roblox project folder>
#   iwr https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.ps1 | iex
#
# Installs the Studio plugin and registers the MCP server with Claude Code.
# The server itself runs on demand via `npx -y tufan-blox-bridge` (no global install).
#
# Params (when run as a file rather than piped):
#   -ProjectRoot <path>   Roblox project root for sync/git (default: current dir)
#   -Force                Overwrite an existing plugin install / MCP entry

[CmdletBinding()]
param(
  [string]$ProjectRoot = (Get-Location).Path,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Step($m) { Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn2($m){ Write-Host "  [!] $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Tufan-Blox-Bridge installer" -ForegroundColor Magenta
Write-Host "  https://github.com/drgost1/Tufan-Blox-Bridge" -ForegroundColor DarkGray
Write-Host ""

# --- prerequisites ---
Step "Checking prerequisites"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Warn2 "Node.js not found. Install from https://nodejs.org (needed to run the MCP server via npx)." }
else { Ok "node $((& node --version))" }
$claude = Get-Command claude -ErrorAction SilentlyContinue

# --- 1. plugin ---
Step "Installing Studio plugin"
$pluginsDir = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'
if (-not (Test-Path $pluginsDir)) { New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null }
$pluginPath = Join-Path $pluginsDir 'TufanBloxBridge.rbxm'
$pluginUrl = 'https://github.com/drgost1/Tufan-Blox-Bridge/releases/latest/download/TufanBloxBridge.rbxm'
$rawFallback = 'https://github.com/drgost1/Tufan-Blox-Bridge/raw/main/TufanBloxBridge.rbxm'

if ((Test-Path $pluginPath) -and -not $Force) {
  Warn2 "Plugin already installed. Re-run with -Force to overwrite."
} else {
  try { Invoke-WebRequest -Uri $pluginUrl -OutFile $pluginPath -UseBasicParsing }
  catch {
    Warn2 "No release asset yet — using main branch build."
    Invoke-WebRequest -Uri $rawFallback -OutFile $pluginPath -UseBasicParsing
  }
  Ok "Installed $pluginPath ($((Get-Item $pluginPath).Length) bytes)"
}

# --- 2. MCP server registration ---
Step "Registering MCP server with Claude Code"
if ($claude) {
  $exists = (& claude mcp list 2>$null) -match 'tufan'
  if ($exists -and -not $Force) {
    Warn2 "Claude Code already has a 'tufan' MCP entry. Re-run with -Force to replace."
  } else {
    if ($exists) { & claude mcp remove tufan 2>$null | Out-Null }
    & claude mcp add tufan --env "TUFAN_PROJECT=$ProjectRoot" -- npx -y tufan-blox-bridge 2>&1 | Out-Null
    # Verify the package name actually landed in the config — a dropped arg
    # produces a silent 30s timeout later, so fail loudly here instead.
    $verify = (& claude mcp get tufan 2>&1 | Out-String)
    if ($verify -match 'tufan-blox-bridge') {
      Ok "Registered + verified: npx -y tufan-blox-bridge  (TUFAN_PROJECT=$ProjectRoot)"
    } else {
      Write-Host "  [X] MCP entry is malformed (the package name didn't register)." -ForegroundColor Red
      Write-Host "      Fix manually:" -ForegroundColor Red
      Write-Host "        claude mcp remove tufan" -ForegroundColor DarkGray
      Write-Host "        claude mcp add tufan --env TUFAN_PROJECT=$ProjectRoot -- npx -y tufan-blox-bridge" -ForegroundColor DarkGray
      Write-Host "      Then confirm with: claude mcp get tufan  (Args must include tufan-blox-bridge)" -ForegroundColor DarkGray
    }
  }
} else {
  Warn2 "Claude Code CLI not found. Add this MCP server manually:"
  Write-Host ""
  Write-Host '    claude mcp add tufan --env TUFAN_PROJECT=' -NoNewline -ForegroundColor DarkGray
  Write-Host "$ProjectRoot -- npx -y tufan-blox-bridge" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  Or for Cursor / Claude Desktop, add to your MCP config:" -ForegroundColor DarkGray
  Write-Host '    "tufan": { "command": "npx", "args": ["-y","tufan-blox-bridge"], "env": { "TUFAN_PROJECT": "' -NoNewline -ForegroundColor DarkGray
  Write-Host "$ProjectRoot`" } }" -ForegroundColor DarkGray
}

# --- done ---
Write-Host ""
Write-Host "  Done. Next:" -ForegroundColor Green
Write-Host "    1. Restart Roblox Studio  -> 'Tufan Studio' toolbar, green 'connected' pill" -ForegroundColor White
Write-Host "    2. Restart your AI client -> it spawns the server on first use" -ForegroundColor White
Write-Host "    3. Add a default.project.json to map folders <-> Studio for file sync" -ForegroundColor White
Write-Host ""
