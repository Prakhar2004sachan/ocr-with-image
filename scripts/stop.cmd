@echo off
rem Stop the studio processes and unload the engine (Windows).
setlocal
cd /d "%~dp0.."
py -3 scripts\stop.py %*
if errorlevel 1 pause
