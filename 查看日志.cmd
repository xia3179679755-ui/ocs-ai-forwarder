@echo off
setlocal
cd /d "%~dp0"

if not exist "logs" (
  echo 还没有日志目录，请先双击 start.cmd 启动服务。
  pause
  exit /b 0
)

for /f "delims=" %%f in ('dir /b /o-d "logs\*.log" 2^>nul') do (
  start "" notepad "logs\%%f"
  exit /b 0
)

echo 还没有日志文件，请先双击 start.cmd 启动服务。
pause
