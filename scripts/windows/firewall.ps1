<#
.SYNOPSIS
  Allows TaazaStream through Windows Firewall on PRIVATE networks only (run as Administrator).

.DESCRIPTION
  Phones, laptops and TVs on your home Wi-Fi need inbound TCP access to the server port.
  The rule is limited to the Private profile and the local subnet, so the port is NOT opened
  on Public networks (cafés, hotels) and not to the internet.

  Make sure your home network is set to "Private":
    Settings > Network & Internet > Wi-Fi (or Ethernet) > your network > Network profile type: Private

  Remove the rule:  powershell -ExecutionPolicy Bypass -File scripts\windows\firewall.ps1 -Remove
#>
param(
  [int]$Port = 3000,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$name = "TaazaStream (TCP $Port)"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Please run this script from an Administrator PowerShell.' -ForegroundColor Yellow
  exit 1
}

Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) { Write-Host "Removed firewall rule '$name'."; exit 0 }

New-NetFirewallRule -DisplayName $name `
  -Description 'TaazaStream local streaming server (LAN only)' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
  -Profile Private -RemoteAddress LocalSubnet | Out-Null

# Optional mDNS (taazastream.local) responses on the LAN.
$mdns = 'TaazaStream mDNS (UDP 5353)'
Get-NetFirewallRule -DisplayName $mdns -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $mdns -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 `
  -Profile Private -RemoteAddress LocalSubnet | Out-Null

Write-Host "Firewall rule '$name' added for Private networks (local subnet only)." -ForegroundColor Green
$profiles = Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory
if ($profiles -notcontains 'Private') {
  Write-Host 'Warning: none of your active networks is set to Private. Set your home Wi-Fi/Ethernet to Private in Windows Settings.' -ForegroundColor Yellow
}
