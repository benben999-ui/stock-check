@echo off
title Reset Stock Check demo data
cd /d "%~dp0"

set "PY="
python --version >nul 2>nul && set "PY=python"
if not defined PY py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY (
  echo Python was not found. See README.md.
  pause
  exit /b 1
)

echo This wipes the activity log, the queue, and all turn-offs,
echo and puts back the original demo data.
choice /c YN /m "Reset demo data now"
if errorlevel 2 exit /b 0

%PY% data\seed.py
echo.
echo Done. If the app is open in your browser, refresh the page (F5).
pause
