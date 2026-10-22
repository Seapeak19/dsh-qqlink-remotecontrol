@echo off
rem desktop-mcp launcher
setlocal
node "%~dp0..\packages\phone-mcp\src\desktop-mcp.mjs" %*
endlocal