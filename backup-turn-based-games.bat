@echo off
REM ============================================================================
REM  Create a timestamped local backup of multiplayer state.
REM  The backups directory is excluded from Git.
REM ============================================================================
setlocal
cd /d "%~dp0"

if not exist "data.json" (
  echo No data.json exists yet; there is nothing to back up.
  exit /b 0
)

if not exist "backups" mkdir "backups"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
copy /Y "data.json" "backups\data-%STAMP%.json" >nul
echo Saved backups\data-%STAMP%.json
endlocal
