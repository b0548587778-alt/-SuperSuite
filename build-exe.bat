@echo off
chcp 65001 >nul
title SuperSuite - build
cd /d "%~dp0"
echo ===== SuperSuite: building the installer =====
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Installing it automatically...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  echo.
  echo Node.js was installed. Close this window and double-click build-exe.bat again.
  pause
  exit /b 0
)
call npm install || (echo npm install failed & pause & exit /b 1)
call npm run dist || (echo build failed & pause & exit /b 1)
echo.
echo Done! Opening the folder with your installer: dist\SuperSuite-Setup.exe
explorer dist
pause
