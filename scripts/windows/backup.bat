@echo off
rem Creates a backup of the TaazaStream database, metadata and settings in the backups folder.
rem Video files are NOT included - back them up separately (see README).
cd /d "%~dp0..\.."
node apps\server\dist\cli\backup.js
pause
