# Downloads the latest Argon.rbxm release into src/vendor/argon/.
# Run from repo root: pwsh scripts/vendor-argon.ps1
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repoRoot 'src\vendor\argon\Argon.rbxm'
$url = 'https://github.com/argon-rbx/argon-roblox/releases/latest/download/Argon.rbxm'

Write-Host "Downloading $url"
Write-Host "  -> $dest"
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
$size = (Get-Item $dest).Length
Write-Host "OK ($size bytes)"
