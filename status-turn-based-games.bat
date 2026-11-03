@echo off
REM ============================================================================
REM  Report the named console, local listener, and Tailscale Serve state.
REM ============================================================================
setlocal
set "TITLE=turn-based-games"
set "PORT=8081"
set "TAILSCALE=%ProgramFiles%\Tailscale\tailscale.exe"

echo === named process ("%TITLE%") ===
tasklist /v /FI "WINDOWTITLE eq %TITLE%*" 2>nul | findstr /I "node cmd" || echo   not running by window title

echo.
echo === local port %PORT% ===
netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" || echo   nothing listening on localhost port %PORT%

echo.
echo === private Tailscale share ===
if exist "%TAILSCALE%" (
  "%TAILSCALE%" serve status
  goto done
)
where tailscale.exe >nul 2>&1
if errorlevel 1 (
  echo   Tailscale CLI is not installed or is not on PATH.
  goto done
)
tailscale.exe serve status

:done
endlocal
