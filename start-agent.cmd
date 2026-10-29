@echo off
setlocal
cd /d "%~dp0"

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current Node.js LTS, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\playwright\package.json" (
  echo Installing the agent dependency...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Checking the Playwright Chromium browser...
call npx playwright install chromium
if errorlevel 1 (
  pause
  exit /b 1
)

call npm start
set "AGENT_EXIT=%ERRORLEVEL%"
echo.
echo Agent exited with code %AGENT_EXIT%.
echo Log file, if created: %LOCALAPPDATA%\FO4PurchaseAgent\agent.log
echo Keep this window open and copy any error message shown above.
pause
exit /b %AGENT_EXIT%
