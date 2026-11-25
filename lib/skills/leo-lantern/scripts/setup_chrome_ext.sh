#!/usr/bin/env bash

# 🛠️ Chrome 插件一键安装引导脚本 (macOS)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_NAME="$(basename "$SKILL_DIR")"
EXT_DIR=""

# 0. 优先检测入参指定的路径
if [ -n "$1" ] && [ -d "$1" ]; then
    EXT_DIR="$(cd "$1" && pwd)"
# 1. 检测运行时标准部署目录 (~/.shrimp/skills/<skillName>/extension)
elif [ -d "$HOME/.shrimp/skills/$SKILL_NAME/extension" ]; then
    EXT_DIR="$HOME/.shrimp/skills/$SKILL_NAME/extension"
# 2. 检测当前 Skill 内置扩展目录 (相对路径 resources/chrome_extension)
elif [ -d "$SKILL_DIR/resources/chrome_extension" ]; then
    EXT_DIR="$(cd "$SKILL_DIR/resources/chrome_extension" && pwd)"
# 3. 广泛检测各 Agent 宿主环境（.agents, .gemini, .claude, .cursor, .zcode 等）
else
    for candidate in \
        "$HOME/.agents/skills/$SKILL_NAME/resources/chrome_extension" \
        "$HOME/.gemini/config/skills/$SKILL_NAME/resources/chrome_extension" \
        "$HOME/.claude/skills/$SKILL_NAME/resources/chrome_extension" \
        "$HOME/.cursor/skills/$SKILL_NAME/resources/chrome_extension" \
        "$HOME/.zcode/skills/$SKILL_NAME/resources/chrome_extension"
    do
        if [ -d "$candidate" ]; then
            EXT_DIR="$candidate"
            break
        fi
    done
fi

if [ -z "$EXT_DIR" ] || [ ! -d "$EXT_DIR" ]; then
    echo "❌ 未能定位到 Chrome 扩展目录，请检查 resources/chrome_extension 是否完整。"
    exit 1
fi

# 复制路径到系统剪贴板 (macOS)
if command -v pbcopy >/dev/null 2>&1; then
    echo -n "$EXT_DIR" | pbcopy
fi

# 仅支持 macOS：打开系统访达高亮选中该文件夹，调起 Google Chrome
if [ "$(uname)" = "Darwin" ]; then
    open -R "$EXT_DIR" 2>/dev/null || true
    open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open "chrome://extensions" 2>/dev/null || true
else
    echo "❌ 本脚本仅支持 macOS，Windows 请使用 setup_chrome_ext.bat。"
    exit 1
fi

echo "======================================================================"
echo "🎉 已为您定位 Chrome 插件目录，并【自动复制到剪贴板】："
echo "   👉 $EXT_DIR"
echo "======================================================================"
echo ""
echo "🚀 接下来只需 2 秒完成安装："
echo "   1. 已为您打开 Chrome 扩展管理页 (chrome://extensions)；"
echo "   2. 请确保页面右上角开启【开发者模式 (Developer mode)】；"
echo "   3. ⚡【核心秒装技巧】：直接将弹出的访达文件夹用鼠标拖入 Chrome 页面中，松手即装好！"
echo "   4. 备选方式：点击左上角【加载已解压的扩展程序】，直接粘贴路径选择即可。"
echo "======================================================================"
