---
name: leo-obs-studio
description: Control OBS Studio on macOS and Windows via WebSocket v5 using local Python scripts in ~/.shrimp/skills/leo-obs-studio/venv, with leo-video-router style workspace memory and dated project archiving. Use when the user asks to record the screen with OBS, start/stop/pause OBS recording, switch OBS scenes, take an OBS scene screenshot, or check/configure OBS automation readiness. 录屏、OBS录制、切场景。
---

# Leo OBS Studio

通过 OBS Studio 内置的 **WebSocket v5** 接口自动化控制录屏、场景切换与画面截图，并采用与 `leo-video-router` 一致的**三级级联工作区记忆 + 标准日期工程归档**，所有命令输出结构化 JSON，方便下游工作流（如 `leo-video-relay` / `leo-video-router`）直接消费成片路径。

## 运行约定

使用固定于 `~/.shrimp/skills/leo-obs-studio/venv` 的 Python 解释器执行 `<本 skill 目录>/scripts/` 下的脚本（脚本亦包含 PEP 723 头，必要时可用 `uv run`）：

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py <command>
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/workspace.py <command>
```

---

## 📁 录屏目录结构与智能工作区记忆 (Smart Persistence)

### 1. 三级级联工作区解析（存储在 `~/.shrimp/skills/leo-obs-studio/config.json`）
1. **用户显式指定**（`workspace.py set-workspace <dir>`、`workspace.py init <主题> --workspace <dir>` 或 `obs_ctl.py start --workspace <dir>`）：自动持久化写入 `config.json` 的 `workspace_dir`，后续免重复输入；
2. **历史工作区**：自动复用 `config.json` 中记录的 `workspace_dir`；
3. **默认兜底目录**：`~/.shrimp/skills/leo-obs-studio/output/`。

### 2. 标准单次录屏工程目录
```text
<workspace_dir>/
└── YYYY-MM-DD-录屏主题/
    ├── 录制记录.md           # 自动记录起止时间、场景与产出的视频/截图路径
    ├── 原始录屏/             # OBS 录屏直出目录（start 自动切换 OBS 录像路径至此）
    ├── 截图/                 # screenshot 自动保存目录
    └── 成片/                 # 后续裁剪、压制或转 GIF 的输出目录
```

---

## 标准工作流

### Step 0：查看工作区与环境自检

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/workspace.py status
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py doctor
```

* **`WEBSOCKET_DISABLED`**：提示用户按 [references/obs_setup.md](references/obs_setup.md) 在 OBS 菜单开启 WebSocket 服务，等待用户确认后再重试。
* **`VENV_MISSING`**：按 [references/obs_setup.md](references/obs_setup.md) 使用 `uv venv` + `uv pip install` 初始化 `~/.shrimp/skills/leo-obs-studio/venv`。
* **`OBS_NOT_RUNNING`**：`ensure --launch` 或 `start` 会自动拉起 OBS 并轮询等待 WebSocket 就绪。

### Step 1：初始化录屏工程（可选，或直接随 `start --topic` 自动建立）

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/workspace.py init "<录屏主题>" [--workspace "<工作区目录>"]
```

### Step 2：查看与切换场景（`scenes` / `scene`）

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py scenes
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py scene "<场景名>"
```

### Step 3：录屏启停与状态查询（`start` / `status` / `stop`）

开始录制（自动确保 OBS 启动、按工程目录设置 OBS 录像路径并切场景）：

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py start [--topic "<录屏主题>"] [--workspace "<工作区目录>"] [--scene "<场景名>"]
```

* 若需临时沿用 OBS 软件自身当前设置的路径（不走工程目录），传 `--use-obs-dir`。
* 若需临时指定单次目录，传 `--record-dir "<目录>"`。

查询状态、暂停与恢复：

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py status
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py pause
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py resume
```

停止录制并获取真实成片路径（返回 JSON 中的 `output_path` 并自动追加到 `录制记录.md`）：

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py stop
```

### Step 4：画面截图（`screenshot`）

```bash
~/.shrimp/skills/leo-obs-studio/venv/bin/python <本 skill 目录>/scripts/obs_ctl.py screenshot [--source "<场景或源名称>"] [--out "<输出路径>"] [--format png]
```

## 持久化配置

`obs_ctl.py` 会自动读取 OBS Studio 本地的 WebSocket 配置文件（端口号与密码）；`workspace_dir`、`default_scene`、`auto_launch` 等偏好保存在 `~/.shrimp/skills/leo-obs-studio/config.json`，**严禁在输出或日志中回显明文密码**。
