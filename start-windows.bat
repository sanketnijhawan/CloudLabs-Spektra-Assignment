@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting CloudLabs workshop dashboard...
echo Open http://localhost:3000 in your browser.
node --env-file-if-exists=.env server\index.mjs
pause
