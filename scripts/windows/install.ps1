<#
.SYNOPSIS
  One-time setup of TaazaStream on a Windows PC.

.DESCRIPTION
  - checks Node.js (20.18+; 24 LTS recommended)
  - enables pnpm through Corepack
  - installs dependencies, builds the server and web app, prepares the database
  - creates .env from .env.example if missing
  - optionally adds a Windows Firewall rule for PRIVATE networks only

  Run from the repository folder:
    powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipFirewall,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $Root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js is not installed. Install the LTS version from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this script again.' -ForegroundColor Yellow
  exit 1
}
$version = (node -v).TrimStart('v')
if ([version]$version -lt [version]'20.18.0') {
  Write-Host "Node.js $version is too old. Install Node.js 20.18+ (24 LTS recommended)." -ForegroundColor Yellow
  exit 1
}
Write-Host "Node.js $version OK"

Step 'Enabling pnpm (Corepack)'
corepack enable 2>$null
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host 'Could not enable the pnpm shim globally (needs admin). Using "corepack pnpm" instead.'
  function pnpm { corepack pnpm @args }
}

Step 'Installing dependencies'
pnpm install --frozen-lockfile

Step 'Checking FFmpeg'
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ff) { Write-Host "System FFmpeg found: $($ff.Source)" }
else {
  Write-Host 'No system FFmpeg found - TaazaStream will use the bundled FFmpeg build.' -ForegroundColor Yellow
  Write-Host 'For the newest codecs/hardware encoders you can install it with: winget install Gyan.FFmpeg'
}

Step 'Creating .env'
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from .env.example (edit it to change the port or add media folders).'
} else { Write-Host '.env already exists - leaving it unchanged.' }

Step 'Building TaazaStream'
pnpm db:generate
pnpm build

if (-not $SkipFirewall) {
  Step "Allowing TCP $Port through Windows Firewall (Private networks only)"
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) {
    & (Join-Path $PSScriptRoot 'firewall.ps1') -Port $Port
  } else {
    Write-Host 'Not running as Administrator - skipped. To allow phones/TVs to connect, run as admin:' -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\windows\firewall.ps1 -Port $Port"
  }
}

Write-Host "`nDone! Start TaazaStream with scripts\windows\start-taazastream.bat" -ForegroundColor Green
Write-Host "Then open http://localhost:$Port/admin on THIS PC to create the admin account."
