# lemo-opuscar

仓库：https://github.com/lemomo-ai/lemo-opuscar

## 适合

- 在 66 种风格里点名做代码短片，含「剪辑与纪实」「实证影像」：档案影像、卫星图、激光点云、CAD 拆解。
- 没选风格时帮用户挑。
- 改风格，或从空白做自己的风格并保存。

## 不适合

- 剪辑、裁剪、转码用户已有视频。

## 安装

- `npx skills add lemomo-ai/lemo-opuscar -g -y`（也可 `claude plugin install`，但 `npx skills` 对所有 agent 通用）。
- 首次运行 `setup.sh` 会把风格库 clone 到 `~/lemo-opuscar`；设 `LEMO_OPUSCAR_HOME=~/.shrimp/skills/lemo-opuscar` 改到默认目录。
- `setup.sh` 每次调用都重新算库目录，agent 的 shell 也不保留变量：**每一条** `setup.sh` 命令前都要带 `LEMO_OPUSCAR_HOME=<目录>`，否则第二次调用会再 clone 一份到 `~/lemo-opuscar`。
- 风格库目录规则：
  - `python3 <本 skill 目录>/scripts/registry.py locate lemo-opuscar`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）返回的 `path` 下有 `AGENTS.md` 和 `core/render/`（用户登记的是完整仓库）→ `<目录>` 取 `<path>`。`setup.sh` 会直接使用这份非它管理的 clone、不自动更新（已读 `setup.sh` 核实）；`setup.sh deps` 会在该目录里建 `.venv` 和 `node_modules`。
  - 否则 `<目录>` 取 `~/.shrimp/skills/lemo-opuscar`。

## 交接

- 从 `locate` 输出的 `entry_dir` 读其 SKILL.md 并按它执行，每条都带前缀：
  1. 取库：`LEMO_OPUSCAR_HOME=<目录> sh "<entry_dir>/scripts/setup.sh"`（最后一行打印 `LIB=<path>`）
  2. 装依赖：`LEMO_OPUSCAR_HOME=<目录> sh "<entry_dir>/scripts/setup.sh" deps [voice] [music]`
  3. 读 `$LIB/AGENTS.md`；需要看某风格的 demo 时：`LEMO_OPUSCAR_HOME=<目录> sh "<entry_dir>/scripts/setup.sh" demo <slug>`
- 项目目录建在用户发起时所在文件夹。

## 音频

- 内生，配乐和音效由代码生成；配音默认中文 edge-tts、英文 Kokoro。
- `TECHNIQUE.md` §4 规定用户带录音就用录音，omnivoice 配音按录音交给它。

## 注意

- 风格库的 `AGENTS.md`（和 `MY-STYLES.md`）里用到 Claude 的 `AskUserQuestion`，其他 agent 改为普通提问。
- 作者说明风格按 Opus 5.5 调校，其他模型效果不保证。
