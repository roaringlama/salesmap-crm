@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if errorlevel 1 goto :node_missing
if not exist "node_modules\" (
  echo 首次启动，正在安装依赖...
  call npm.cmd install
  if errorlevel 1 goto :install_failed
)
echo 请保持此窗口打开，在浏览器访问 http://127.0.0.1:5173
call npm.cmd run dev
if errorlevel 1 goto :start_failed
exit /b 0

:node_missing
echo 未找到 npm。请安装 Node.js 24，然后重新启动。
pause
exit /b 1

:install_failed
echo 依赖安装失败，请检查网络及终端错误信息。
pause
exit /b 1

:start_failed
echo 启动失败，请检查上方错误信息。若端口 5173 已占用，请先停止其他 CRM 服务。
pause
exit /b 1
