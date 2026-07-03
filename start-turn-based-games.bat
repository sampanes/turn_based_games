@echo off
REM ============================================================================
REM  Start the local game server in a titled console so it is easy to identify
REM  and stop. The application listens on localhost only; private remote access
REM  is provided separately by Tailscale Serve.
REM ============================================================================
setlocal
set "TITLE=turn-based-games"
set "HOST=127.0.0.1"
set "PORT=8080"
cd /d "%~dp0"

taskkill /FI "WINDOWTITLE eq %TITLE%*" /T /F >nul 2>&1

echo Starting "%TITLE%" on http://%HOST%:%PORT%/ ...
start "%TITLE%" cmd /k node server.js

echo.
echo   Local URL:       http://%HOST%:%PORT%/
echo   Private sharing: enable-private-share.bat
echo   Status:          status-turn-based-games.bat
echo   Stop:            stop-turn-based-games.bat
endlocal
