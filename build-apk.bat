@echo off
chcp 65001 >nul
title SuperSuite - Android
cd /d "%~dp0"
rem בניית אפליקציית האנדרואיד בלחיצה כפולה. צריך רק את הסיסמה שעל הנייר —
rem המפתח נפתח מהגיבוי המוצפן ב-Documents (ראו android/README.md). בלי חיבור לרשת.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Run build-exe.bat once first - it installs Node.js.
  pause
  exit /b 1
)
call node android/build-apk.js || (echo. & echo Android build failed - see the message above & pause & exit /b 1)
echo.
explorer dist
pause