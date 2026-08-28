#!/bin/sh
# 🚀 自包含的 ego-browser 一键全自动静默安装脚本（专为 leo-live-runner 设计）
set -eu

log() { printf '%s\n' "$*" >&2; }
die() { log "❌ 错误: $*"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "此脚本仅支持 macOS 系统。"

APP_PATH="/Applications/ego lite.app"
LOCAL_BIN="$HOME/.local/bin"

# 1. 自动选择架构与下载地址
if [ "$(uname -m)" = "arm64" ]; then
  DMG_URL="https://cdn.ego.app/setup/macos/arm64/egolite.dmg"
else
  DMG_URL="https://cdn.ego.app/setup/macos/x64/egolite.dmg"
fi

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ego-install.XXXXXX")
MOUNT_DIR="$TEMP_DIR/mount"
DMG_PATH="$TEMP_DIR/egolite.dmg"
mkdir -p "$MOUNT_DIR"

cleanup() {
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

# 2. 如果未安装 App，下载并解压到 /Applications
if [ ! -d "$APP_PATH" ]; then
  log "⬇️ 正在从 CDN 下载 ego lite ($DMG_URL) ..."
  curl -fL --retry 3 --output "$DMG_PATH" "$DMG_URL" || die "下载失败，请检查网络。"

  log "📦 正在挂载安装包并安装到 /Applications ..."
  hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_DIR" >/dev/null
  
  APP_IN_DMG=$(find "$MOUNT_DIR" -maxdepth 2 -type d -iname "ego lite.app" | head -n 1)
  [ -n "$APP_IN_DMG" ] || die "安装包内未找到 ego lite.app"

  ditto "$APP_IN_DMG" "$APP_PATH" || die "拷贝到 /Applications 失败"
  xattr -dr com.apple.quarantine "$APP_PATH" >/dev/null 2>&1 || true
fi

# 3. 自动查找内置 helper 并创建软链接
HELPER_BIN=$(find "$APP_PATH/Contents" -type f -name "ego-browser" 2>/dev/null | head -n 1)
[ -n "$HELPER_BIN" ] || die "未能定位到内置 ego-browser 二进制文件"

mkdir -p "$LOCAL_BIN"
ln -sf "$HELPER_BIN" "$LOCAL_BIN/ego-browser"
log "🔗 已成功创建命令行软链接: $LOCAL_BIN/ego-browser"

log "🎉 ego-browser 安装就绪！可直接在终端中调用。"
