@echo off
setlocal
title Visual UI Studio
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set "STUDIO_INSTALLED=%LOCALAPPDATA%\Programs\Visual UI Studio\Visual UI Studio.exe"
if exist "%STUDIO_INSTALLED%" (
  start "" "%STUDIO_INSTALLED%"
  exit /b 0
)
call npm run build
if errorlevel 1 exit /b 1
call npm run start
exit /b %errorlevel%
