# Tufan-Blox-Bridge — one-line installer
#
# Usage from PowerShell (NOT cmd.exe):
#   iwr https://raw.githubusercontent.com/drgost1/Tufan-Blox-Bridge/main/install.ps1 | iex
#
# Does, idempotently:
#   1. Download latest TufanBloxBridge.rbxm from GitHub releases into the
#      Roblox plugins folder
#   2. Download Argon CLI for this platform if `argon` is not on PATH, drop it
#      into ~/.tufan-bridge/bin and add to PATH (current session + persisted)
#   3. Detect Claude Code MCP config and patch in robloxstudio-mcp if absent
#   4. Print clear next steps

[CmdletBinding()]
param(
	[switch]$SkipArgon,
	[switch]$SkipMcp,
	[switch]$SkipPlugin,
	[switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest is much faster without

function Write-Step($msg) { Write-Host "▶ $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red }

if ($PSVersionTable.PSVersion.Major -lt 5) {
	Write-Err "PowerShell 5+ required. You have $($PSVersionTable.PSVersion)."
	exit 1
}
if (-not $IsWindows -and -not ($env:OS -like '*Windows*')) {
	Write-Warn2 "This script targets Windows. Mac/Linux: open an issue, we'll add support."
}

Write-Host ""
Write-Host "  Tufan-Blox-Bridge installer" -ForegroundColor Magenta
Write-Host "  https://github.com/drgost1/Tufan-Blox-Bridge" -ForegroundColor DarkGray
Write-Host ""

# ---------- 1. Plugin ----------
if (-not $SkipPlugin) {
	Write-Step "Installing TufanBloxBridge.rbxm"
	$pluginsDir = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'
	if (-not (Test-Path $pluginsDir)) {
		New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null
	}
	$pluginPath = Join-Path $pluginsDir 'TufanBloxBridge.rbxm'
	$pluginUrl = 'https://github.com/drgost1/Tufan-Blox-Bridge/releases/latest/download/TufanBloxBridge.rbxm'
	# Fallback to main branch's built artifact if no release yet
	$rawFallback = 'https://github.com/drgost1/Tufan-Blox-Bridge/raw/main/TufanBloxBridge.rbxm'

	if ((Test-Path $pluginPath) -and -not $Force) {
		Write-Warn2 "TufanBloxBridge.rbxm already installed. Re-run with -Force to overwrite."
	} else {
		try {
			Invoke-WebRequest -Uri $pluginUrl -OutFile $pluginPath -UseBasicParsing
		} catch {
			Write-Warn2 "No GitHub Release found yet — trying main branch artifact."
			Invoke-WebRequest -Uri $rawFallback -OutFile $pluginPath -UseBasicParsing
		}
		$size = (Get-Item $pluginPath).Length
		Write-Ok "Installed $pluginPath ($size bytes)"
	}
}

# ---------- 2. Argon CLI ----------
if (-not $SkipArgon) {
	Write-Step "Installing Argon CLI"
	$existing = Get-Command argon -ErrorAction SilentlyContinue
	if ($existing -and -not $Force) {
		$ver = & argon --version 2>$null
		Write-Ok "argon already on PATH ($ver)"
	} else {
		$argonHome = Join-Path $HOME '.tufan-bridge'
		$argonBin = Join-Path $argonHome 'bin'
		if (-not (Test-Path $argonBin)) { New-Item -ItemType Directory -Path $argonBin -Force | Out-Null }

		# Detect architecture
		$arch = if ([Environment]::Is64BitOperatingSystem) {
			if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
				'aarch64'
			} else {
				'x86_64'
			}
		} else {
			'i686'
		}

		$argonUrl = "https://github.com/argon-rbx/argon/releases/latest/download/argon-windows-$arch.zip"
		$zipPath = Join-Path $env:TEMP "argon-$(Get-Random).zip"
		Invoke-WebRequest -Uri $argonUrl -OutFile $zipPath -UseBasicParsing
		Expand-Archive -Path $zipPath -DestinationPath $argonBin -Force
		Remove-Item $zipPath -Force

		# Persist PATH for future sessions (user scope, no admin needed)
		$userPath = [Environment]::GetEnvironmentVariable('PATH','User')
		if ($userPath -notlike "*$argonBin*") {
			[Environment]::SetEnvironmentVariable('PATH', "$userPath;$argonBin", 'User')
			$env:PATH = "$env:PATH;$argonBin"
			Write-Ok "Added $argonBin to PATH"
		}

		$ver = & "$argonBin\argon.exe" --version 2>$null
		Write-Ok "Installed Argon CLI ($ver)"
	}
}

# ---------- 3. MCP config for Claude Code ----------
if (-not $SkipMcp) {
	Write-Step "Configuring Claude Code MCP"
	$claudeConfig = Join-Path $env:USERPROFILE '.claude.json'
	# Claude Code also supports per-project: %APPDATA%/Claude/claude_desktop_config.json (Claude Desktop) — we patch the Code one
	if (Test-Path $claudeConfig) {
		try {
			$json = Get-Content $claudeConfig -Raw | ConvertFrom-Json
			$mcpKey = 'mcpServers'
			if (-not $json.PSObject.Properties.Name -contains $mcpKey) {
				$json | Add-Member -Type NoteProperty -Name $mcpKey -Value (New-Object PSObject) -Force
			}
			if ($json.$mcpKey.PSObject.Properties.Name -contains 'robloxstudio' -and -not $Force) {
				Write-Warn2 "Claude Code already has 'robloxstudio' MCP entry. Use -Force to overwrite."
			} else {
				$entry = [PSCustomObject]@{
					command = 'npx'
					args = @('-y', 'robloxstudio-mcp@latest')
				}
				$json.$mcpKey | Add-Member -Type NoteProperty -Name 'robloxstudio' -Value $entry -Force
				$json | ConvertTo-Json -Depth 20 | Set-Content $claudeConfig -Encoding utf8
				Write-Ok "Patched $claudeConfig with robloxstudio MCP entry"
			}
		} catch {
			Write-Warn2 "Could not parse $claudeConfig — patch manually. See README."
		}
	} else {
		Write-Warn2 "No Claude Code config at $claudeConfig — using Cursor/Claude Desktop? See README for manual MCP setup."
	}
}

# ---------- 4. Next steps ----------
Write-Host ""
Write-Host "  Setup complete. Next steps:" -ForegroundColor Green
Write-Host ""
Write-Host "    1. In your Roblox project folder, run:" -ForegroundColor White
Write-Host "         argon init" -ForegroundColor DarkGray
Write-Host "         argon serve" -ForegroundColor DarkGray
Write-Host ""
Write-Host "    2. Restart Roblox Studio. Look for the 'Tufan Studio' toolbar." -ForegroundColor White
Write-Host ""
Write-Host "    3. Restart your AI client (Claude Code / Cursor) so it picks up MCP." -ForegroundColor White
Write-Host ""
Write-Host "  Docs: https://github.com/drgost1/Tufan-Blox-Bridge" -ForegroundColor DarkGray
Write-Host ""
