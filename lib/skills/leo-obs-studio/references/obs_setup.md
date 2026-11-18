# OBS Studio 首次配置与虚拟环境指引

## 1. 开启 OBS WebSocket 服务（必须，仅需一次）

1. 打开 **OBS Studio**。
2. 顶部菜单栏点击 **工具（Tools）→ WebSocket 服务器设置（WebSocket Server Settings）**。
3. 勾选 **开启 WebSocket 服务器（Enable WebSocket server）**。
4. 端口保持默认 `4455`；如开启身份验证，建议保持自动生成密码或设置强密码。
5. 点击 **确定（OK）** 保存。

`obs_ctl.py` 会自动读取 OBS 本地配置文件中的端口与密码：
* macOS：`~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json`
* Windows：`%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`
* Linux：`~/.config/obs-studio/plugin_config/obs-websocket/config.json`

如需覆盖默认连接参数、默认场景或录屏输出目录，可通过 `obs_ctl.py config set` 持久化到 `~/.shrimp/skills/leo-obs-studio/config.json`。

## 2. 推荐预先建好的 OBS 场景

建议在 OBS 界面提前建好 2~3 个常用场景（场景名建议清晰固定，方便 Agent 精确切换）：

* `Screen-Clean`：纯显示器采集（Mac 显示器采集 / ScreenCaptureKit）
* `Screen-Audio`：显示器采集 + macOS 系统音频采集（macOS 13+ OBS 原生支持 `macOS Audio Capture`，无需虚拟声卡）
* `Window-Demo`：单窗口采集（防止录制时暴露桌面其他窗口）

## 3. macOS 系统权限

首次录制前，确保 **系统设置 → 隐私与安全性** 中已勾选 **OBS**：

* **屏幕录制与系统音频录制**：允许 `OBS.app`
* **麦克风**（如需解说）：允许 `OBS.app`

## 4. 虚拟环境初始化（`uv`）

本 Skill 的独立虚拟环境固定放在 `~/.shrimp/skills/leo-obs-studio/venv`（严格遵循 `uv` 工具链，不使用传统 `pip`）：

```bash
# macOS / Linux
uv venv ~/.shrimp/skills/leo-obs-studio/venv
uv pip install --python ~/.shrimp/skills/leo-obs-studio/venv/bin/python obsws-python

# Windows (PowerShell)
uv venv "$HOME\.shrimp\skills\leo-obs-studio\venv"
uv pip install --python "$HOME\.shrimp\skills\leo-obs-studio\venv\Scripts\python.exe" obsws-python
```
