@echo off
rem Install only if Electron is missing (npm install fails behind a filter and blocked the start)
if not exist "node_modules\electron\dist\electron.exe" call npm install
call npm start
