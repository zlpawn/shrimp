# 实战踩坑记录（Pitfalls）

来源：2026-11 在 Apple Silicon Mac (darwin arm64) 上从零搭建 Android 模拟器环境、安装大型商业 App（266MB）并自动化其登录界面的全过程实录。

---

## §1 环境搭建：优先 adb CLI，不依赖插件/MCP

**现象**：曾尝试通过 android-emulator MCP 插件操作，其 preflight 报 adb/emulator/sdkmanager 全部 not found；自行安装 SDK 到 `~/android-sdk` 后，插件仍找不到（它只认 Android Studio 默认路径或自己的环境变量）。

**结论**：adb CLI 是零依赖、最通用的路径——任何 Agent 只要能执行 shell 命令就能完成全部操作（截图/点击/日志均有等价命令，见 adb-cheatsheet.md）。本 skill 全部基于 adb CLI。

## §2 环境搭建：sdkmanager 需要接受许可 + 下载量大

- `sdkmanager --install` 前必须先接受许可：`yes | sdkmanager --licenses`（需用户同意，这是 Google SDK 许可协议）
- 组件下载总量约 2.3GB（platform-tools + emulator + android-35 系统镜像），耗时数分钟，建议后台执行
- Apple Silicon Mac 必须选 `arm64-v8a` 架构镜像；`system-images;android-35;default;arm64-v8a` 实测可用
- cmdline-tools 解压后目录结构必须是 `~/android-sdk/cmdline-tools/latest/bin/...`（zip 解压出来是 `cmdline-tools/`，要改名/移动成 `latest/`），否则 sdkmanager 报错

## §3 环境搭建：avdmanager 创建 AVD 的交互坑

`avdmanager create avd` 会交互式询问"是否自定义硬件profile"，需要用 `echo no |` 管道喂入：

```bash
echo no | avdmanager create avd -n <avd名> -k "system-images;android-35;default;arm64-v8a" -d pixel_7 --force
```

## §4 启动：模拟器开机慢，必须等 boot_completed

- `adb wait-for-device` 只等 adb 连上，**不等于系统开机完成**；此时装 APK 会失败
- 必须轮询 `getprop sys.boot_completed` 直到返回 1（首次启动 1-2 分钟）
- 模拟器窗口是 GUI 桌面窗口，headless 场景可加 `-no-window`

## §5 输入：`input text` 丢字符 + 重复叠加（最大的坑）

**现象**：
- 输入 `12345678`，实际只进了 `123`（数字输入随机丢字符）
- 输入框已有内容时再次 `input text`，结果是**叠加**（如密码被拼成两遍）而不是替换

**解法（标准输入序列）**：
1. `input tap` 点入输入框
2. `input text "..."`
3. **立即 uiautomator dump 验证**输入框 text；不对则清空重输
4. 清空：`input keyevent 123`（光标到末尾）+ 循环 N 次 `input keyevent 67`（退格，N 要大于现有字符数）

**根因**：`input text` 逐字符发送事件，模拟器负载高时会丢；且它从不清空已有内容。

## §6 启动 App：monkey 不可靠

**现象**：`adb shell monkey -p <包名> -c android.intent.category.LAUNCHER 1` 返回 `VM exiting with result code -5`，App 没起来。

**解法**：先解析启动 Activity，再显式 am start：
```bash
adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER <包名>  # 输出 <包名>/<Activity>
adb shell am start -n <包名>/<Activity>
```

## §7 勾选框：点击后必须验证 checked 状态

**现象**：点击协议勾选框后，UI dump 里 `checked="false"`（点歪或没生效），直接点登录报"请阅读并勾选隐私协议"。

**解法**：每次点勾选框后重新 dump，确认目标节点的 checked 状态；未生效则重试（坐标取 bounds 中心点）。

## §8 联网操作：请求卡死要设超时止损

**现象**：App 内触发联网请求（如登录）后，加载动画转圈超过 20 秒无响应，前台 Activity 不变。

**通用原因**：模拟器网络不通，或目标服务端不可达/对模拟器环境有限制。任何依赖网络的 App 操作都可能遇到，不是特定 App 的问题。

**解法（通用规则）**：
- 涉及联网的操作一律设 15-20 秒超时，超时即止损，不要无限等待
- 止损后先排查模拟器网络：`adb shell ping -c 2 www.baidu.com`（注意此命令本身也可能卡住，外层要设 timeout）
- 区分"网络不通"与"App 自身问题"：网络通但仍失败，再看 logcat 找 App 报错
- 若目标 App 连的是内网/受限环境（如生产环境风控），提前和用户确认该环境是否适合模拟器访问

## §11 安装：测试包版本低于已装包会失败（VERSION_DOWNGRADE）

**现象**：`adb install -r test.apk` 报 `INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected: Update version code X is older than current Y`。

**原因**：测试包 versionCode 常低于已安装的正式包（如测试版 8.19.0-build 低于线上 8.17.0-release 的 versionCode），`-r` 覆盖安装不允许降级。

**解法**：先卸载再安装（注意会清掉 App 本地数据）：
```bash
adb uninstall <包名>
adb install <apk路径>
```

## §9 中文输入不支持

`adb shell input text` 只支持 ASCII。中文/空格/特殊字符需要：
- 装 ADBKeyBoard 输入法后：`adb shell am broadcast -a ADB_INPUT_TEXT --es msg '中文内容'`
- 或剪贴板方案（`adb shell am broadcast -a clipper.set`，需装 Clipper）

## §10 环境变量持久化

自装 SDK 不在 PATH 里，每次都要 `export PATH=~/android-sdk/platform-tools:$PATH`。持久化方案是**追加**到 `~/.zshrc`（勿破坏已有内容）：

```bash
# Android SDK (added by ...)
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

注意：已开着的终端不会自动生效，需 `source ~/.zshrc` 或重开。
