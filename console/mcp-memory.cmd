@echo off
rem memory-mcp launcher
setlocal
node "%~dp0..\packages\phone-mcp\src\memory-mcp.mjs" %*
endlocal