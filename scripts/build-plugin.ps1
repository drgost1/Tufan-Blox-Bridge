# Builds the Studio plugin into TufanBloxBridge.rbxm using Argon CLI as a builder.
# Argon is used only to compile the Rojo-style tree to a model file — it is NOT a
# runtime dependency of the plugin.
[CmdletBinding()]
param([switch]$Install)
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repoRoot 'plugin\default.project.json'
$output = Join-Path $repoRoot 'TufanBloxBridge.rbxm'

# Prefer the repo-local builder (tools/argon.exe) so this repo is self-contained;
# fall back to argon on PATH. Get it with: scripts\get-builder.ps1  (or download
# argon-windows-x86_64 from github.com/argon-rbx/argon/releases into tools/).
$argon = $null
foreach ($c in @((Join-Path $repoRoot 'tools\argon.exe'), 'argon', 'rojo')) {
	$g = Get-Command $c -ErrorAction SilentlyContinue
	if ($g) { $argon = $g.Source; break }
}
if (-not $argon) { throw "No plugin builder found. Put argon.exe in tools/ (github.com/argon-rbx/argon/releases) or install rojo." }

& $argon build $project --output $output 2>$null
if (-not (Test-Path $output)) { throw "build failed: $output not produced" }
Write-Host "Built $output ($((Get-Item $output).Length) bytes)"

if ($Install) {
	$dest = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins\TufanBloxBridge.rbxm'
	Copy-Item $output $dest -Force
	Write-Host "Installed to $dest"
}
