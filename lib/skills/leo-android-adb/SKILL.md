---
name: leo-android-adb
description: 通过 adb CLI 搭建和操控 Android 模拟器：环境安装、AVD 创建、APK 安装启动、界面自动化（截图/点击/输入/元素分析）与日志排查。纯命令行方案，任何 Agent 均可使用。
---

# Leo Android ADB — Android 模拟器自动化

触发时机：用户需要在 Android 模拟器（或 USB 真机）上安装/运行 APK、自动化操作 App 界面（点击、输入、截图）、查看 App 运行日志、或从零搭建 Android 模拟器环境。

## 核心原则

- **一切操作通过 adb CLI 完成**，无需安装任何插件、MCP 服务或 GUI 工具，只要终端能执行命令即可。
- **每次操作后必须验证**：点击/输入后用 `uiautomator dump` 或截图确认状态，不要盲操作（输入会丢字符、点击会点歪，详见 references/pitfalls.md）。
- **环境自检先行**：先 `adb version` 和 `adb devices` 确认工具与设备状态，再决定是搭环境还是直接操作。
- **联网操作设超时**：涉及 App 联网请求（登录、下单等）的操作要设 15-20 秒超时，超时即止损排查网络，勿无限等待。
- **过程数据集中存放、及时清理**：截图、ui dump 等过程文件统一放在 `~/.shrimp/skills/leo-android-adb/`（下称 `$WORK_DIR`），任务完成后清理该目录，不污染 `/tmp`。

## 工作流

### 1. 环境检查（每次开始先做）

```bash
export WORK_DIR=~/.shrimp/skills/leo-android-adb && mkdir -p $WORK_DIR   # 过程数据目录（任务完成后清理）
adb version          # adb 是否可用
adb devices          # 是否有已连接的模拟器/真机
```

- `adb` 不可用 → 按第 2 步搭建环境
- `adb devices` 列表为空 → 按第 3 步启动模拟器（或连接真机）

### 2. 从零搭建环境（仅当本机无 Android SDK 时）

完整流程与踩坑见 `references/pitfalls.md` §环境搭建。要点：

```bash
# ① 下载 command-line tools（约 150MB）到 ~/android-sdk/cmdline-tools/latest
# ② 接受许可并安装组件（约 2.3GB，需用户同意 SDK 许可协议）
sdkmanager --install "platform-tools" "emulator" "system-images;android-35;default;arm64-v8a" "platforms;android-35"
# ③ 创建 AVD
avdmanager create avd -n <avd名> -k "system-images;android-35;default;arm64-v8a" -d pixel_7 --force
# ④ 写入 ~/.zshrc（追加，勿破坏已有内容）：
#    export ANDROID_HOME="$HOME/android-sdk"
#    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

注意：Apple Silicon (arm64) Mac 必须用 `arm64-v8a` 镜像；消费级模拟器（雷电/夜神等）不支持 macOS ARM。

### 3. 启动模拟器并等待开机

```bash
emulator -avd <avd名> -no-snapshot-load &     # 后台启动，桌面会弹出手机窗口
adb wait-for-device                            # 等 adb 连上
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 2; done; echo BOOTED'  # 等系统开机完成（首次 1-2 分钟）
```

### 4. 安装与启动 App

```bash
adb install -r <path/to/app.apk>              # 安装（-r 覆盖安装）
adb shell pm list packages -3                 # 列出第三方包名，确认安装成功
adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER <包名>  # 查启动 Activity
adb shell am start -n <包名>/<启动Activity>   # 显式启动（不要用 monkey，见 pitfalls §6）
```

### 5. 界面感知（操作前先"看"）

```bash
# 截图（保存到本机查看）
adb exec-out screencap -p > $WORK_DIR/screen.png

# 导出界面元素树 XML（含每个控件的 resource-id / text / bounds 坐标 / checked 状态）
adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml > $WORK_DIR/ui.xml

# 查看当前前台 Activity（确认页面切换是否成功）
adb shell "dumpsys activity activities | grep topResumedActivity"
```

从 ui.xml 中提取关键信息（示例）：
```bash
adb shell cat /sdcard/ui.xml | grep -oE '<node[^>]*resource-id="[^"]*et_username"[^>]*bounds="[^"]*"'
# bounds="[84,766][996,875]" → 控件矩形 [左,上][右,下]，点击坐标取中心：(540, 820)
```

### 6. 界面操作（点/输/按键）

```bash
adb shell input tap <x> <y>               # 点击坐标
adb shell input text "ascii_only"         # 输入文本（仅 ASCII！中文/空格不支持）
adb shell input keyevent 67               # 退格键；123=光标移到末尾；4=BACK；3=HOME；66=ENTER
adb shell input swipe 540 1500 540 500 300  # 滑动（x1 y1 x2 y2 时长ms）
```

**输入框标准操作序列**（防丢字符/残留，实测必须这样做）：
1. `input tap` 点击输入框获得焦点
2. `input text "..."` 输入
3. **立即 dump 验证**输入框 text 是否完整；不完整则清空重输
4. 清空方法：`input keyevent 123`（光标到末尾）+ 循环 `input keyevent 67`（逐字退格）

### 7. 日志排查

```bash
adb logcat -d | grep -iE "FATAL|Exception|<包名>" | tail -20   # 崩溃/报错
adb logcat -d -t 500                                             # 最近 500 行
adb shell "dumpsys activity activities | grep topResumedActivity" # 前台页面
```

### 8. 收尾

```bash
adb emu kill          # 关闭模拟器（AVD 保留，下次可直接启动）
rm -rf $WORK_DIR      # 清理过程数据（截图、ui dump 等）
```

## 参考文档

- `references/pitfalls.md` — 实战踩坑记录（环境搭建、输入丢字符、monkey 失败、线上包风控等 8 类坑及解法）
- `references/adb-cheatsheet.md` — adb 命令速查表（按场景分类）

## 边界与注意事项

- 涉及**接受 SDK 许可协议、删除 AVD、wipe 模拟器数据**等操作前，先征得用户同意
- App 联网请求卡住时，先排查模拟器网络（`adb shell ping`），再判断是网络问题还是 App 自身问题
- 敏感信息（账号密码）不要写入任何持久化文件
