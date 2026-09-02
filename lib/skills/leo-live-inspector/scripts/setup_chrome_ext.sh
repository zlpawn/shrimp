#!/usr/bin/env bash

# 🛠️ Leo Live Inspector - Chrome 插件一键安装引导脚本 (macOS)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR=""

# 1. 优先定位用户全局 Skill 目录
if [ -d "$HOME/.agents/skills/leo-live-inspector/resources/chrome_extension" ]; then
    EXT_DIR="$HOME/.agents/skills/leo-live-inspector/resources/chrome_extension"
# 2. 次级定位本地仓库 Skill 目录
elif [ -d "$SCRIPT_DIR/../resources/chrome_extension" ]; then
    EXT_DIR="$(cd "$SCRIPT_DIR/../resources/chrome_extension" && pwd)"
# 3. 兜底定位 extensions 源码目录
elif [ -d "$SCRIPT_DIR/../../../extensions/leo-cookie-txt-locally" ]; then
    EXT_DIR="$(cd "$SCRIPT_DIR/../../../extensions/leo-cookie-txt-locally" && pwd)"
fi

if [ -z "$EXT_DIR" ] || [ ! -d "$EXT_DIR" ]; then
    echo "❌ 未能定位到 Chrome 扩展目录，请检查文件完整性。"
    exit 1
fi

# 复制路径到系统剪贴板 (macOS pbcopy)
echo -n "$EXT_DIR" | pbcopy

echo "======================================================================"
echo "🎉 已为您定位 Chrome 插件目录，并【自动复制到剪贴板】：
echo "   👉 $EXT_DIR"
echo "======================================================================"
echo ""
echo "🚀 接下来只需 10 秒完成安装："
echo "   1. 正在为您打开 Chrome 扩展管理页 (chrome://extensions)；"
echo "   2. 请确保页面右上角开启【开发者模式 (Developer mode)】；"
echo "   3. 点击左上角【加载已解压的扩展程序 (Load unpacked)】；"
echo "   4. 在弹出的文件选择窗口中，按快捷键 Cmd + Shift + G；"
echo "   5. 按 Cmd + V 粘贴路径，按回车，再点击右下角【选择】即可！"
echo "======================================================================"

# 打开 Chrome 扩展页面
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open "chrome://extensions" 2>/dev/null || true
