@echo off
rem Renew the GitHub token - see tools\renew-github-token.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\renew-github-token.ps1"
