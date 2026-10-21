@echo off
setlocal
title OCS 答题本地转发 - 127.0.0.1:8765
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required.
  echo Install Node.js, then double-click this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Created .env. Fill in your API key, base URL and model names, then run this file again.
  notepad ".env"
  pause
  exit /b 0
)

node ".\src\run.mjs"
echo.
echo The local forwarder stopped. Press any key to close.
pause >nul
