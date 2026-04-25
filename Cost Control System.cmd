@echo off
setlocal

set "PROJECT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%launch-cost-control.ps1"

endlocal
