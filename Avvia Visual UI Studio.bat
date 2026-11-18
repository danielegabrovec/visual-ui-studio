@echo off
title Visual UI Studio 0.1.0
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "out\main\index.js" (
  echo [Visual UI Studio] Compilazione bundle iniziale in corso...
  call npm run build
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0out\main\index.js"
exit /b 0
