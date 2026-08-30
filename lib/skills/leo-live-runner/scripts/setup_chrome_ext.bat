@echo off
setlocal
set EXT_DIR=%~dp0..\..\..\extensions\leo-cookie-txt-locally
for %%i in ("%EXT_DIR%") do set "ABS_EXT_DIR=%%~fi"

if exist "%ABS_EXT_DIR%" (
    echo %ABS_EXT_DIR% | clip
    echo [OK] Chrome 扩展目录路径已自动复制到系统剪贴板: %ABS_EXT_DIR%
) else (
    echo [INFO] 正在定位扩展目录...
)

start chrome.exe "chrome://extensions"
echo ======================================================================
echo  1. 已为您启动 Chrome 并打开扩展管理页 (chrome://extensions)
echo  2. 请在页面右上角开启 [开发者模式 (Developer mode)]
echo  3. 点击左上角 [加载已解压的扩展程序 (Load unpacked)]
echo  4. 在文件夹选择弹窗中直接按 Ctrl + V 粘贴路径并按回车确定！
echo ======================================================================
pause
