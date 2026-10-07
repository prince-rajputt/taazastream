@echo off
rem TaazaStream launcher - double-click to start the server.
rem Keep this window open while you watch. Close it (or press Ctrl+C) to stop.
title TaazaStream Server
cd /d "%~dp0..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Run scripts\windows\install.ps1 first.
  pause
  exit /b 1
)

if not exist "apps\server\dist\index.js" (
  echo TaazaStream is not built yet. Running the installer...
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\install.ps1" -SkipFirewall
  if errorlevel 1 ( pause & exit /b 1 )
)

set NODE_ENV=production
echo Starting TaazaStream...
node apps\server\dist\index.js
echo.
echo TaazaStream has stopped.
pause
