@echo off
setlocal
cd /d "%~dp0"

REM ============================================================
REM  start-server.bat - launch Turn-Based Games in a window
REM  NAMED "turn-based-games" so it is easy to find and kill.
REM  Idempotent: tears down any prior instance before starting,
REM  so you never stack duplicate node.exe servers.
REM  Stop it with: stop-server.bat   (or Ctrl+C in the window)
REM ============================================================

REM --- tear down any previous instance first ---
taskkill /FI "WINDOWTITLE eq turn-based-games*" /T /F >nul 2>&1

echo Starting "turn-based-games" on http://127.0.0.1:8080 ...
start "turn-based-games" cmd /c "cd /d %~dp0 && node server.js || pause"

echo.
echo   Window title : turn-based-games
echo   URL          : http://127.0.0.1:8080/
echo   To stop      : run stop-server.bat  (or Ctrl+C in that window)
echo.
endlocal
