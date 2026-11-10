@echo off
rem Download the model weights (Windows).
setlocal
cd /d "%~dp0.."
py -3 scripts\download_models.py %*
if errorlevel 1 pause
