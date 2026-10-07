<#
.SYNOPSIS
  Start TaazaStream automatically when you sign in to Windows (Task Scheduler), or remove it.

  Enable:  powershell -ExecutionPolicy Bypass -File scripts\windows\autostart.ps1
  Disable: powershell -ExecutionPolicy Bypass -File scripts\windows\autostart.ps1 -Remove
#>
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$task = 'TaazaStream Server'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

if ($Remove) {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$task'."
  exit 0
}

$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument 'apps\server\dist\index.js' -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description 'TaazaStream local streaming server' -Force | Out-Null
Write-Host "TaazaStream will now start automatically when $env:USERNAME signs in." -ForegroundColor Green
