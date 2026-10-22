@echo off
chcp 65001 >nul
rem 小鲸鱼控制台入口（旧的 companion 启动器已移到 backup）
start "" wscript.exe "%~dp0console\start-console.vbs"
exit /b 0