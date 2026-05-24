# Builds the Studio plugin into TufanBloxBridge.rbxm using Argon CLI as a builder.
# Argon is used only to compile the Rojo-style tree to a model file — it is NOT a
# runtime dependency of the plugin.
[CmdletBinding()]
param([switch]$Install)
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repoRoot 'plugin\default.project.json'
$output = Join-Path $repoRoot 'TufanBloxBridge.rbxm'

$argon = $null
foreach ($c in @('C:\Users\drgos_5ax3dfg\roblox\tools\argon.exe', 'argon')) {
	$g = Get-Command $c -ErrorAction SilentlyContinue
	if ($g) { $argon = $g.Source; break }
}
if (-not $argon) { throw "argon CLI not found (used as the plugin builder)." }

& $argon build $project -o $output -y 2>$null
if (-not (Test-Path $output)) { throw "build failed: $output not produced" }
Write-Host "Built $output ($((Get-Item $output).Length) bytes)"

if ($Install) {
	$dest = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins\TufanBloxBridge.rbxm'
	Copy-Item $output $dest -Force
	Write-Host "Installed to $dest"
}
