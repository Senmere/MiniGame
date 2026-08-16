@echo off
title AIchess Arena - One-Click Start
cd /d "%~dp0"

rem ========== 0. Locate bundled portable Node ==========
set "NODE_DIR=%~dp0.tools\node-v24.19.0-win-x64"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"

if not exist "%NODE_EXE%" (
    echo [ERROR] Portable Node not found: %NODE_DIR%
    echo         Please extract the Node distribution into .tools\node-v24.19.0-win-x64\
    pause
    exit /b 1
)
if not exist "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" (
    echo [ERROR] npm is missing in the portable Node. Please re-extract the full Node package.
    pause
    exit /b 1
)

rem ========== 1. Auto-install dependencies on first run ==========
if not exist "node_modules" (
    echo [FIRST RUN] Installing dependencies, this may take a few minutes...
    call "%NPM_CMD%" install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed. Check your network and retry.
        pause
        exit /b 1
    )
)

rem ========== 2. Environment ==========
set "PATH=%NODE_DIR%;%PATH%"
set "NODE_OPTIONS=--experimental-sqlite"
set "npm_config_registry=https://registry.npmmirror.com"
set "PORT=4000"
set "WEB_ORIGIN=http://localhost:5173"

rem ========== 3. Info banner ==========
echo.
echo ============================================================
echo   AIchess Arena  -  One-Click Start
echo ------------------------------------------------------------
echo   Frontend:  http://localhost:5173
echo   Backend:   http://localhost:4000   (health: /api/health)
echo   First use: open the page, go to Settings, add your models
echo   Stop:      press Ctrl+C in this window
echo ============================================================
echo.

rem ========== 4. Open browser after a short delay (skip with --no-browser) ==========
if /i not "%~1"=="--no-browser" (
    start "" /b cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:5173"
)

rem ========== 5. Start backend + frontend together ==========
call "%NPM_CMD%" run dev
