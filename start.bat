@echo off
title Stock Check prototype
cd /d "%~dp0"

rem Find Python ("python" or the "py" launcher).
set "PY="
python --version >nul 2>nul && set "PY=python"
if not defined PY py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY goto nopython

%PY% server.py
echo.
echo The app has stopped.
pause
exit /b 0

:nopython
echo.
echo  Python was not found on this computer.
echo  Install it from https://www.python.org/downloads/
echo  and tick "Add python.exe to PATH" during setup. See README.md.
echo.
pause
exit /b 1
