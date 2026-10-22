@echo off
chcp 65001 >nul
setlocal
title 小鲸鱼 · 停止
echo.
echo   正在停止 qq-bridge 和 SnowLuma（DSH 不会关）...
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3900/api/stop' -ContentType 'application/json' -Body '{}' | Out-Null; Write-Host '   已发送停止指令' } catch { Write-Host ('   控制台没在跑：' + $_.Exception.Message) }"
ping -n 4 127.0.0.1 >nul
echo.
echo   完成。DSH 和控制台还在；要全停请退出 DSH / 关掉控制台窗口。
echo.
pause
endlocal