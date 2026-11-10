@echo off
rem Run the offline test suites (Windows). Add --e2e for the browser suite.
setlocal
cd /d "%~dp0.."
py -3 scripts\test_all.py %*
if errorlevel 1 pause
