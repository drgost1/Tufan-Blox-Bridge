# Tufan-Blox-Bridge -- one-line installer (Windows PowerShell 5.1+ or PowerShell 7).
#
#   cd <your Roblox project folder>
#   iwr https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.ps1 | iex
#
# What it does:
#   1. Checks Node.js >= 18
#   2. npm i -g tufan-blox-bridge            (the MCP server, on your PATH)
#   3. tufan-blox-bridge install-plugin      (Studio plugin -> %LOCALAPPDATA%\Roblox\Plugins)
#   4. Registers the MCP server with Claude Code (if the `claude` CLI is on PATH),
#      else prints ready-to-paste config for Cursor / Claude Desktop.
#
# Params (when run as a file rather than piped):
#   -ProjectRoot <path>   Roblox project root for sync/git (default: current dir)
#   -Force                Overwrite an existing MCP entry

[CmdletBinding()]
param(
  [string]$ProjectRoot = (Get-Location).Path,
  [switch]$Force
)
# NOTE: 'Continue' + explicit $LASTEXITCODE checks -- with 'Stop', PowerShell 5.1
# turns native-command stderr (npm progress) into a spurious NativeCommandError.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Step($m) { Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn2($m){ Write-Host "  [!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  [X] $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Tufan-Blox-Bridge installer" -ForegroundColor Magenta
Write-Host "  https://github.com/drgost1/Tufan-Blox-Bridge" -ForegroundColor DarkGray
Write-Host ""

# --- 1. prerequisites: node >= 18 ---
Step "Checking Node.js (need >= 18)"
$nodeVer = $null
try { $nodeVer = (& node --version 2>$null) } catch { $nodeVer = $null }
if (-not $nodeVer) { Die "Node.js not found. Install it from https://nodejs.org (LTS) and re-run." }
$major = 0
try { $major = [int]($nodeVer.TrimStart('v').Split('.')[0]) } catch { $major = 0 }
if ($major -lt 18) { Die "Node.js $nodeVer is too old -- the bridge needs >= 18. Update from https://nodejs.org and re-run." }
Ok "node $nodeVer"

# --- 2. global server install ---
Step "Installing the MCP server (npm i -g tufan-blox-bridge)"
& npm i -g tufan-blox-bridge 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Die "npm i -g tufan-blox-bridge failed (exit $LASTEXITCODE). Run it manually to see the error." }
$cli = Get-Command tufan-blox-bridge -ErrorAction SilentlyContinue
if (-not $cli) { Die "Install reported success but 'tufan-blox-bridge' isn't on PATH -- restart the terminal and re-run." }
Ok "tufan-blox-bridge on PATH"

# --- 3. Studio plugin ---
Step "Installing the Studio plugin (tufan-blox-bridge install-plugin)"
$pluginOut = (& tufan-blox-bridge install-plugin 2>&1 | Out-String)
if ($LASTEXITCODE -eq 0) {
  Ok "Studio plugin installed"
} else {
  Warn2 "install-plugin failed -- if your globally installed version is old, update: npm i -g tufan-blox-bridge@latest"
  Write-Host $pluginOut -ForegroundColor DarkGray
  Warn2 "Manual fallback: download TufanBloxBridge.rbxm from https://github.com/drgost1/Tufan-Blox-Bridge/releases/latest"
  Warn2 "and drop it into $env:LOCALAPPDATA\Roblox\Plugins"
}

# --- 4. MCP client registration ---
Step "Registering the MCP server"
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
  $exists = (& claude mcp list 2>$null | Out-String) -match 'tufan'
  if ($exists -and -not $Force) {
    Warn2 "Claude Code already has a 'tufan' MCP entry. Re-run with -Force to replace."
  } else {
    if ($exists) { & claude mcp remove tufan 2>$null | Out-Null }
    & claude mcp add tufan --env "TUFAN_PROJECT=$ProjectRoot" -- tufan-blox-bridge 2>&1 | Out-Null
    # Verify the command actually landed in the config -- a dropped arg produces a
    # silent 30s timeout later, so fail loudly here instead.
    $verify = (& claude mcp get tufan 2>&1 | Out-String)
    if ($verify -match 'tufan-blox-bridge') {
      Ok "Registered + verified with Claude Code (TUFAN_PROJECT=$ProjectRoot)"
    } else {
      Write-Host "  [X] MCP entry is malformed (the command didn't register)." -ForegroundColor Red
      Write-Host "      Fix manually:" -ForegroundColor Red
      Write-Host "        claude mcp remove tufan" -ForegroundColor DarkGray
      Write-Host "        claude mcp add tufan --env TUFAN_PROJECT=$ProjectRoot -- tufan-blox-bridge" -ForegroundColor DarkGray
      Write-Host "      Then confirm with: claude mcp get tufan" -ForegroundColor DarkGray
    }
  }
} else {
  Warn2 "Claude Code CLI not found -- skipping auto-registration."
}

# Always print the paste-ready config for other clients.
Write-Host ""
Write-Host "  MCP client config (Cursor / Claude Desktop / any MCP client):" -ForegroundColor White
Write-Host '    {' -ForegroundColor DarkGray
Write-Host '      "mcpServers": {' -ForegroundColor DarkGray
Write-Host '        "tufan": {' -ForegroundColor DarkGray
Write-Host '          "command": "tufan-blox-bridge",' -ForegroundColor DarkGray
Write-Host "          `"env`": { `"TUFAN_PROJECT`": `"$($ProjectRoot -replace '\\','/')`" }" -ForegroundColor DarkGray
Write-Host '        }' -ForegroundColor DarkGray
Write-Host '      }' -ForegroundColor DarkGray
Write-Host '    }' -ForegroundColor DarkGray
Write-Host "  Optional env: TUFAN_OPENCLOUD_KEY (Open Cloud: datastore / cloud_luau / server logs), TUFAN_MESHY_KEY (AI 3D generation)." -ForegroundColor DarkGray
Write-Host "  Alternative to the global install: use `"command`": `"npx`", `"args`": [`"-y`", `"tufan-blox-bridge`"]" -ForegroundColor DarkGray

# --- done ---
Write-Host ""
Write-Host "  Done. Next:" -ForegroundColor Green
Write-Host "    1. Restart Roblox Studio  -> 'Tufan Studio' toolbar, green 'connected' pill" -ForegroundColor White
Write-Host "    2. Restart your AI client -> it spawns the server on first use" -ForegroundColor White
Write-Host "    3. Add a default.project.json to map folders <-> Studio for file sync" -ForegroundColor White
Write-Host ""
