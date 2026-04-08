@echo off
title Nielsen Processor — Build .exe
color 0B
cd /d %~dp0

echo.
echo  ================================================
echo   Nielsen Processor v4.0 — Build Tool
echo   Creates .exe (Windows) + binaries (Mac)
echo  ================================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)

:: ── IMPORTANT: Check credentials are set up BEFORE building ──
echo  Checking credentials setup...
if not exist credentials.enc (
    echo.
    echo  ╔══════════════════════════════════════════════════════╗
    echo  ║  STOP — Credentials not set up yet!                 ║
    echo  ║                                                      ║
    echo  ║  Before building, you must:                         ║
    echo  ║  1. Run START.bat                                    ║
    echo  ║  2. Open http://localhost:3000                       ║
    echo  ║  3. Create vault password                            ║
    echo  ║  4. Click Credentials - fill SAS URL, ADF details   ║
    echo  ║  5. Click Save and Encrypt                           ║
    echo  ║  6. Close the app                                    ║
    echo  ║  7. Run BUILD.bat again                              ║
    echo  ╚══════════════════════════════════════════════════════╝
    echo.
    pause & exit /b 1
)
if not exist .vaultkey (
    echo  [WARN] .vaultkey missing - users will see vault setup screen.
    echo  Run START.bat first and save credentials.
    echo.
    pause & exit /b 1
)
echo  [OK] credentials.enc and .vaultkey found.

echo.
echo  [Step 1/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 ( echo  [ERROR] npm install failed. & pause & exit /b 1 )
echo  [OK] Dependencies ready.

echo.
echo  [Step 2/3] Installing pkg...
call npm install -g pkg
if %errorlevel% neq 0 ( echo  [ERROR] pkg install failed. & pause & exit /b 1 )
echo  [OK] pkg ready.

echo.
echo  [Step 3/3] Building executables (2-5 mins)...
if not exist dist mkdir dist

echo   Building Windows x64...
call pkg server.js --target node18-win-x64 --output dist\nielsen-win.exe
if %errorlevel% neq 0 ( echo  [ERROR] Windows build failed. & pause & exit /b 1 )
echo   [OK] nielsen-win.exe

echo   Building Mac Intel (x64)...
call pkg server.js --target node18-macos-x64 --output dist\nielsen-mac-intel
echo   [OK] nielsen-mac-intel

echo   Building Mac Apple Silicon (arm64)...
call pkg server.js --target node18-macos-arm64 --output dist\nielsen-mac-arm
echo   [OK] nielsen-mac-arm

echo.
echo  Copying runtime files to dist\...
copy /Y index.html        dist\index.html      >nul
copy /Y credentials.enc   dist\credentials.enc >nul
copy /Y .vaultkey         dist\.vaultkey       >nul
copy /Y dist-README.txt   dist\README.txt      >nul 2>&1
xcopy /E /I /Y /Q DQChecks dist\DQChecks       >nul
echo  [OK] All files copied including credentials.enc and .vaultkey

:: Windows START.bat
(
echo @echo off
echo cd /d %%~dp0
echo title Nielsen Processor v4.0
echo color 0A
echo echo.
echo echo  ============================================
echo echo   Nielsen Processor v4.0
echo echo  ============================================
echo echo.
echo echo  Open your browser and go to:
echo echo.
echo echo    http://localhost:3000
echo echo.
echo echo  Keep this window open. Close when done.
echo echo  ============================================
echo echo.
echo start "" "http://localhost:3000"
echo nielsen-win.exe
echo pause
) > dist\START-Windows.bat

:: Mac START.command
(
echo #!/bin/bash
echo cd "$(dirname "$0")"
echo echo ""
echo echo "  Nielsen Processor v4.0"
echo echo "  Starting..."
echo echo ""
echo ARCH=$(uname -m)
echo if [ "$ARCH" = "arm64" ]; then
echo   chmod +x ./nielsen-mac-arm
echo   (sleep 2 ^&^& open "http://localhost:3000") ^&
echo   ./nielsen-mac-arm
echo else
echo   chmod +x ./nielsen-mac-intel
echo   (sleep 2 ^&^& open "http://localhost:3000") ^&
echo   ./nielsen-mac-intel
echo fi
) > dist\START-Mac.command

echo.
echo  ================================================
echo   BUILD COMPLETE!  dist\ folder contains:
echo.
echo   nielsen-win.exe       Windows executable
echo   nielsen-mac-arm       Mac M1/M2/M3
echo   nielsen-mac-intel     Mac Intel
echo   credentials.enc       Encrypted credentials
echo   .vaultkey             Auto-unlock key
echo   index.html            UI
echo   DQChecks\             DQ validators
echo   START-Windows.bat     Windows launcher
echo   START-Mac.command     Mac launcher
echo.
echo   Zip dist\ folder and share with users.
echo   Users just unzip and double-click START file.
echo  ================================================
echo.
pause

