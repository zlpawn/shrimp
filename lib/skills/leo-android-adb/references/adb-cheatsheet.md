# adb 命令速查表（按场景分类）

前提：`ANDROID_HOME=~/android-sdk`，adb 在 `$ANDROID_HOME/platform-tools/adb`。

过程数据（截图、ui dump 等）统一存放 `$WORK_DIR`（默认 `~/.shrimp/skills/leo-android-adb/`），任务完成后清理。

## 设备管理

| 命令 | 说明 |
|---|---|
| `adb devices` | 列出已连接设备/模拟器 |
| `adb devices -l` | 详细信息（含型号） |
| `adb -s <serial> <命令>` | 指定某台设备执行 |
| `adb wait-for-device` | 阻塞等待设备连上 |
| `adb emu kill` | 关闭模拟器 |

## 模拟器 / AVD

| 命令 | 说明 |
|---|---|
| `emulator -list-avds` | 列出所有 AVD |
| `emulator -avd <名称> &` | 后台启动模拟器 |
| `emulator -avd <名称> -no-snapshot-load` | 冷启动（不用快照） |
| `emulator -avd <名称> -no-window` | 无界面启动 |
| `avdmanager list avd` | 列出 AVD 详情 |
| `echo no \| avdmanager create avd -n <名> -k "system-images;android-35;default;arm64-v8a" -d pixel_7 --force` | 创建 AVD |

## 应用管理

| 命令 | 说明 |
|---|---|
| `adb install [-r] <apk>` | 安装（-r 覆盖） |
| `adb install-multiple <apk>...` | 分包安装 |
| `adb uninstall <包名>` | 卸载 |
| `adb shell pm list packages -3` | 列第三方包 |
| `adb shell pm path <包名>` | 查 APK 安装路径 |
| `adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER <包名>` | 查启动 Activity |
| `adb shell am start -n <包名>/<Activity>` | 显式启动 App |
| `adb shell am force-stop <包名>` | 强制停止 |

## 界面感知（操作前先看）

| 命令 | 说明 |
|---|---|
| `adb exec-out screencap -p > $WORK_DIR/s.png` | 截图到本机 |
| `adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml` | 导出界面元素树 |
| `adb shell "dumpsys activity activities \| grep topResumedActivity"` | 当前前台 Activity |
| `adb shell wm size` | 屏幕分辨率 |

ui.xml 关键字段：`resource-id`（控件ID）、`text`（文字）、`bounds="[l,t][r,b]"`（坐标矩形，点击取中心）、`checked`（勾选状态）、`clickable`。

## 界面操作

| 命令 | 说明 |
|---|---|
| `adb shell input tap <x> <y>` | 点击 |
| `adb shell input text "ascii"` | 输入（仅 ASCII，会丢字符需验证） |
| `adb shell input keyevent <code>` | 按键：4=BACK 3=HOME 66=ENTER 67=退格 123=光标到末尾 |
| `adb shell input swipe <x1> <y1> <x2> <y2> [ms]` | 滑动 |
| `adb shell input keyevent --longpress 4` | 长按返回 |

**输入框标准序列**：tap 聚焦 → input text → dump 验证 → 不对则 keyevent 123 + 循环 67 清空重输。

## 日志

| 命令 | 说明 |
|---|---|
| `adb logcat -d` | 全量日志（-d 输出后退出） |
| `adb logcat -d -t 500` | 最近 500 行 |
| `adb logcat -d \| grep -iE "FATAL\|Exception"` | 过滤崩溃 |
| `adb logcat --pid=$(adb shell pidof <包名>)` | 按进程过滤 |

## 文件传输

| 命令 | 说明 |
|---|---|
| `adb push <本地> <设备路径>` | 电脑 → 设备 |
| `adb pull <设备路径> <本地>` | 设备 → 电脑 |

## 网络（模拟器内）

| 命令 | 说明 |
|---|---|
| `adb shell ping -c 2 <host>` | 测连通性（可能卡住，注意超时） |
| `adb shell settings get global http_proxy` | 查代理设置 |
| `adb shell svc wifi enable/disable` | 开关 WiFi |

## 常用组合套路

```bash
# 完整启动流程
emulator -avd <avd名> -no-snapshot-load &
adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 2; done; echo BOOTED'

# 安装并启动
adb install -r app.apk
adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER com.xxx | tail -1
adb shell am start -n com.xxx/.MainActivity

# 操作 + 验证循环
adb shell input tap 540 820
adb shell cat $WORK_DIR/ui.xml | grep -oE '<node[^>]*et_username[^>]*>' | grep -oE 'text="[^"]*"'
```
