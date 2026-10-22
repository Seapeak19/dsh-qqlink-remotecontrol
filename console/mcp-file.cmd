@echo off
rem file-mcp launcher (MCP SDK lives in packages/phone-mcp/node_modules)
setlocal
node "%~dp0..\packages\phone-mcp\src\file-mcp.mjs" %*
endlocal