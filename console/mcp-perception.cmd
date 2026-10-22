@echo off
rem perception-mcp launcher
setlocal
node "%~dp0..\packages\phone-mcp\src\perception-mcp.mjs" %*
endlocal