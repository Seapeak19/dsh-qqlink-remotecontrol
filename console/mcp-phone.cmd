@echo off
rem phone-mcp launcher (MuMu/adb; override PHONE_ADB / PHONE_SERIAL in the env)
setlocal
if not defined PHONE_ADB set "PHONE_ADB=adb"
if not defined PHONE_SERIAL set "PHONE_SERIAL=127.0.0.1:16384"
"%PHONE_ADB%" connect %PHONE_SERIAL% >nul 2>&1
node "%~dp0..\packages\phone-mcp\src\phone-mcp.js"
endlocal