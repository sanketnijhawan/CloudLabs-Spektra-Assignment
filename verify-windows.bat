@echo off
cd /d "%~dp0"
echo Installing optional test and screenshot tools...
call npm ci
if errorlevel 1 goto failed
call npm test
if errorlevel 1 goto failed
call npm run test:ui
if errorlevel 1 goto failed
call npx playwright install chromium
if errorlevel 1 goto failed
call npm run screenshots
if errorlevel 1 goto failed
echo Verification finished. Review the images in the screenshots folder before submitting.
start "" "%~dp0screenshots"
pause
exit /b 0
:failed
echo A check failed. Read the error above; do not submit until it is resolved.
pause
exit /b 1
