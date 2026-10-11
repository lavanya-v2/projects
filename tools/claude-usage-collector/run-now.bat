@echo off
REM Double-click to push your latest Claude usage to Lens right now.
REM No admin needed. (Requires config.json - run setup.js first.)
cd /d "%~dp0"
node collector.js
echo.
pause
