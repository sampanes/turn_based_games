@echo off
REM ============================================================================
REM  Stop the named game-server process, then clean up a leftover port listener.
REM  The private Tailscale route can remain configured while the backend is off.
REM ============================================================================
setlocal
set "TITLE=turn-based-games"
set "PORT=8080"

echo Stopping "%TITLE%" ...
taskkill /FI "WINDOWTITLE eq %TITLE%*" /T /F >nul 2>&1

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:"127.0.0.1:%PORT% .*LISTENING"') do (
  echo   stopping leftover PID %%p on localhost port %PORT%
  taskkill /PID %%p /T /F >nul 2>&1
)

echo Done.
endlocal
