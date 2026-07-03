@echo off
REM ============================================================================
REM  Configure Tailscale Serve for private tailnet-only HTTPS access.
REM  This does not use Tailscale Funnel and does not make the game public.
REM ============================================================================
setlocal
set "PORT=8080"

where tailscale.exe >nul 2>&1
if errorlevel 1 (
  echo Tailscale is not installed or is not on PATH.
  exit /b 1
)

echo Enabling private Tailscale Serve access to localhost port %PORT% ...
echo This may open a browser for one-time HTTPS approval.
tailscale serve --bg %PORT%
if errorlevel 1 (
  echo.
  echo Tailscale Serve was not enabled. Try this helper from an Administrator console.
  exit /b 1
)

echo.
echo Private sharing is configured. Use status-turn-based-games.bat to inspect it.
endlocal
