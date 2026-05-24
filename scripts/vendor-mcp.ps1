# Downloads the latest MCPPlugin.rbxmx release into src/vendor/mcp/.
# Run from repo root: pwsh scripts/vendor-mcp.ps1
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repoRoot 'src\vendor\mcp\MCPPlugin.rbxmx'
$url = 'https://github.com/boshyxd/robloxstudio-mcp/releases/latest/download/MCPPlugin.rbxmx'

Write-Host "Downloading $url"
Write-Host "  -> $dest"
try {
	Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
} catch {
	Write-Warning "Default MCPPlugin.rbxmx release asset not found. Trying the inspector edition."
	$url = 'https://github.com/boshyxd/robloxstudio-mcp/releases/latest/download/MCPInspectorPlugin.rbxmx'
	Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}
$size = (Get-Item $dest).Length
Write-Host "OK ($size bytes)"
