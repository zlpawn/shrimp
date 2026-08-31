@echo off
setlocal enabledelayedexpansion

:: 1. 优先定位 Skill 内置的自包含扩展目录 (即使脱离网关独立分发也能 100% 找到)
set "EXT_DIR=%~dp0..\resources\chrome_extension"
if not exist "!EXT_DIR!" (
    :: 2. 次级兜底：尝试定位 Monorepo 根目录下的 extensions 目录
    set "EXT_DIR=%~dp0..\..\..\extensions\leo-cookie-txt-locally"
)

if exist "!EXT_DIR!" (
    for %%i in ("!EXT_DIR!") do set "ABS_EXT_DIR=%%~fi"
    echo !ABS_EXT_DIR! | clip
    echo [OK] Chrome 扩展目录已成功定位并复制到系统剪贴板:
    echo      !ABS_EXT_DIR!
) else (
    echo [WARN] 未能自动定位内置扩展目录，请将解压后的插件文件夹拖入本窗口。
)

:: 3. 自动启动 Chrome 并打开扩展管理页
start chrome.exe "chrome://extensions"

echo.
echo ======================================================================
echo  1. 已为您启动 Chrome 并打开扩展管理页 (chrome://extensions)
echo  2. 请在页面右上角开启 [开发者模式 (Developer mode)]
echo  3. 点击左上角 [加载已解压的扩展程序 (Load unpacked)]
echo  4. 在文件夹选择弹窗的路径栏中直接按 Ctrl + V 粘贴路径并按回车确定！
echo ======================================================================
echo.
pause
