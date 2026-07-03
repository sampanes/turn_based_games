@echo off
REM ============================================================================
REM  Report the named console, local listener, and Tailscale Serve state.
REM ============================================================================
setlocal
set "TITLE=turn-based-games"
set "PORT=8080"

echo === named process ("%TITLE%") ===
tasklist /v /FI "WINDOWTITLE eq %TITLE%*" 2>nul | findstr /I "node cmd" || echo   not running by window title

echo.
echo === local port %PORT% ===
netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" || echo   nothing listening on localhost port %PORT%

echo.
echo === private Tailscale share ===
where tailscale.exe >nul 2>&1
if errorlevel 1 (
  echo   Tailscale CLI is not installed or is not on PATH.
  goto done
)
powershell -NoProfile -Command "$p = Start-Process -FilePath 'tailscale.exe' -ArgumentList 'serve','status' -NoNewWindow -PassThru; if (-not $p.WaitForExit(5000)) { $p.Kill(); Write-Host '  Tailscale status timed out.' }"

:done
endlocal
