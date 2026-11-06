@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 1/2 重新构建界面（改动 core/ data/ ui/ 后必须先构建） ===
call npm run ui:build
if errorlevel 1 (
  echo.
  echo 构建失败：把上面的红字发给助手。
  pause
  exit /b 1
)
echo === 2/2 打开界面 ===
start "" "%~dp0temp\build\ui\index.html"
