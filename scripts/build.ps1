# Builds TufanBloxBridge.rbxm using Argon CLI.
# Run from repo root: pwsh scripts/build.ps1 [-Install]
[CmdletBinding()]
param(
	[switch]$Install
)
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$projectFile = Join-Path $repoRoot 'default.project.json'
$output = Join-Path $repoRoot 'TufanBloxBridge.rbxm'

# Locate argon.exe — prefer the one shipped with the Chomolokko repo, fall back to PATH.
$argon = $null
$siblingArgon = 'C:\Users\drgos_5ax3dfg\roblox\tools\argon.exe'
if (Test-Path $siblingArgon) {
	$argon = $siblingArgon
} else {
	$cmd = Get-Command argon -ErrorAction SilentlyContinue
	if ($cmd) { $argon = $cmd.Source }
}
if (-not $argon) { throw "argon CLI not found. Install argon-rbx/argon and re-run." }

Write-Host "Using argon at: $argon"
Write-Host "Building $projectFile -> $output"

$args = @('build', $projectFile, '-o', $output, '-y')
if ($Install) { $args += '-p' }

& $argon @args

if (-not (Test-Path $output)) {
	throw "Build did not produce $output"
}

$size = (Get-Item $output).Length
Write-Host "OK ($size bytes)  $output"

if ($Install) {
	$pluginsDir = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'
	$installed = Join-Path $pluginsDir 'TufanBloxBridge.rbxm'
	Copy-Item $output $installed -Force
	Write-Host "Installed to $installed"
}
