@echo off
chcp 65001 >nul
title SuperSuite - build
cd /d "%~dp0"
echo ===== SuperSuite: building the installers =====
rem ארבע המהדורות (shell/edition.js): המלאה, עמותות, נדל"ן ועסקים, חשבונאות. מהדורה אחת: build-exe.bat npo
set "PRODUCT=%~1"
if "%PRODUCT%"=="" set "PRODUCT=all"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Installing it automatically...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  echo.
  echo Node.js was installed. Close this window and double-click build-exe.bat again.
  pause
  exit /b 0
)
rem אם node_modules כבר קיים — אין צורך בהתקנה ואין לפנות לרשת.
rem אם הוא חסר, מנסים התקנה לא-רשתית מהמטמון של npm; אם גם זה נכשל, עוצרים.
if not exist "node_modules\electron-builder" (
  echo node_modules is missing. Trying an offline install from the npm cache...
  call npm install --offline || (echo Offline install failed - cannot build without network & pause & exit /b 1)
)
rem בנייה מהמטמון המקומי — בלי הורדות רשת. ראו build-local.js
call node build-local.js --product=%PRODUCT% || (echo build failed & pause & exit /b 1)
echo.
echo Done! Installers:
echo   dist\SuperSuite-Setup.exe                  (full)
echo   dist\npo\SuperSuite-Amutot-Setup.exe        (amutot)
echo   dist\realty\SuperSuite-Nadlan-Setup.exe     (nadlan)
echo   dist\acct\SuperSuite-Heshbonaut-Setup.exe   (heshbonaut)
explorer dist
pause
