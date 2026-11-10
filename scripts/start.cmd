@echo off
rem Start the Unlimited OCR Studio (Windows dev mode).
setlocal
cd /d "%~dp0.."
py -3 scripts\start.py %*
if errorlevel 1 pause
