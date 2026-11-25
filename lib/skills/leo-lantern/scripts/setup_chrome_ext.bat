@echo off
setlocal enabledelayedexpansion

:: 动态获取当前 Skill 名称与目录（零硬编码）
set "SCRIPT_DIR=%~dp0"
for %%I in ("%~dp0..") do set "SKILL_NAME=%%~nxI"
for %%I in ("%~dp0..") do set "SKILL_DIR=%%~fi"

:: 0. 优先检测入参指定的路径
if not "%~1"=="" if exist "%~1" (
    set "EXT_DIR=%~1"
    goto :found
)

:: 1. 检测运行时标准部署目录 (~/.shrimp/skills/<skillName>/extension)
if exist "%USERPROFILE%\.shrimp\skills\!SKILL_NAME!\extension" (
    set "EXT_DIR=%USERPROFILE%\.shrimp\skills\!SKILL_NAME!\extension"
    goto :found
)

:: 2. 检测当前 Skill 内置扩展目录 (相对路径 resources\chrome_extension)
if exist "!SKILL_DIR!\resources\chrome_extension" (
    set "EXT_DIR=!SKILL_DIR!\resources\chrome_extension"
    goto :found
)

:: 3. 广泛检测各 Agent 宿主环境（.agents, .gemini, .claude, .cursor, .zcode 等）
for %%d in (
    "%USERPROFILE%\.agents\skills\!SKILL_NAME!\resources\chrome_extension"
    "%USERPROFILE%\.gemini\config\skills\!SKILL_NAME!\resources\chrome_extension"
    "%USERPROFILE%\.claude\skills\!SKILL_NAME!\resources\chrome_extension"
    "%USERPROFILE%\.cursor\skills\!SKILL_NAME!\resources\chrome_extension"
    "%USERPROFILE%\.zcode\skills\!SKILL_NAME!\resources\chrome_extension"
) do (
    if exist "%%~d" (
        set "EXT_DIR=%%~d"
        goto :found
    )
)

:found
if exist "!EXT_DIR!" (
    for %%i in ("!EXT_DIR!") do set "ABS_EXT_DIR=%%~fi"
    echo !ABS_EXT_DIR! | clip
    echo [OK] Chrome 扩展目录已成功定位并复制到系统剪贴板:
    echo      !ABS_EXT_DIR!
    explorer.exe /select,"!ABS_EXT_DIR!"
) else (
    echo [WARN] 未能自动定位内置扩展目录，请检查 resources/chrome_extension 是否存在。
    exit /b 1
)

:: 4. 自动启动 Google Chrome 并打开扩展管理页
start chrome.exe "chrome://extensions"

echo.
echo ======================================================================
echo  1. 已为您启动 Chrome 并打开扩展管理页 (chrome://extensions)
echo  2. 请在页面右上角开启 [开发者模式 (Developer mode)]
echo  3. ⚡ [核心秒装技巧]：直接将弹出的资源管理器文件夹拖入 Chrome 窗口中！
echo  4. 备用方式：点击左上角 [加载已解压的扩展程序]，直接 Ctrl + V 粘贴路径确定！
echo ======================================================================
echo.
pause
