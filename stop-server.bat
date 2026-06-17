@echo off
REM ============================================================
REM  stop-server.bat - tear down the "turn-based-games" server.
REM  1) kills the named window (and its node child tree)
REM  2) falls back to whatever is LISTENING on :8080
REM ============================================================

echo Stopping "turn-based-games" ...
taskkill /FI "WINDOWTITLE eq turn-based-games*" /T /F
if not errorlevel 1 goto done

echo No matching window - checking port 8080 ...
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
  set "FOUND=1"
  echo   killing PID %%p
  taskkill /PID %%p /F
)
if not defined FOUND echo Nothing listening on :8080 - already stopped.

:done
echo Done.
