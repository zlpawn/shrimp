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
- 风格库目录规则：
  - `python3 scripts/registry.py locate lemo-opuscar`（Windows 上用 `python`）返回的 `path` 下有 `AGENTS.md` 和 `core/render/`（用户登记的是完整仓库）→ 运行 `setup.sh` 前设 `LEMO_OPUSCAR_HOME=<path>`。`setup.sh` 会直接使用这份非它管理的 clone、不自动更新（已读 `setup.sh` 核实）；`setup.sh deps` 会在该目录里建 `.venv` 和 `node_modules`。
  - 否则设 `LEMO_OPUSCAR_HOME=~/.shrimp/skills/lemo-opuscar`。

## 交接

- 从 `locate` 输出的 `entry_dir` 读其 SKILL.md 并按它执行：`setup.sh` 取库 → `setup.sh deps` 装依赖 → 读 `$LIB/AGENTS.md`。
- 项目目录建在用户发起时所在文件夹。

## 音频

- 内生，配乐和音效由代码生成；配音默认中文 edge-tts、英文 Kokoro。
- `TECHNIQUE.md` §4 规定用户带录音就用录音，omnivoice 配音按录音交给它。

## 注意

- SKILL 里用到 Claude 的 `AskUserQuestion`，其他 agent 改为普通提问。
- 作者说明风格按 Opus 5.5 调校，其他模型效果不保证。
