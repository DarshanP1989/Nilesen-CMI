@echo off
cd /d %~dp0
title Nielsen Processor v4.0
color 0A
echo.
echo  ================================================
echo   Nielsen Processor v4.0
echo  ================================================
echo.

echo  Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Download from: https://nodejs.org ^(LTS version^)
    echo.
    pause
    exit /b 1
)
echo  Node.js found. OK.
echo.

if not exist server.js (
    echo  [ERROR] server.js not found in this folder!
    echo  All files must be in the same folder as START.bat
    echo.
    pause
    exit /b 1
)

echo  Checking dependencies...
if not exist node_modules (
    echo  Installing dependencies - please wait...
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install failed - check internet connection.
        echo.
        pause
        exit /b 1
    )
    echo  Dependencies installed.
) else (
    echo  Dependencies OK.
)
echo.

echo  Checking server...
node --check server.js >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Problem in server.js:
    node --check server.js
    echo.
    pause
    exit /b 1
)
echo  Server OK.
echo.

echo  ================================================
echo   Server running at: http://localhost:3000
echo.
echo   Open Chrome or Edge and go to that address.
echo   Keep this window open. Press CTRL+C to stop.
echo  ================================================
echo.

node server.js
echo.
echo  Server stopped.
echo.
pause
