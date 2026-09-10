@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install it from https://nodejs.org (the LTS version), then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
)

node src/cli.js

echo.
pause