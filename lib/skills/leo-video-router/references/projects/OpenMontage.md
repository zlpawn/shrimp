# OpenMontage

仓库：https://github.com/calesthio/OpenMontage

## 适合

- 已有素材的加工：真人口播剪辑（talking-head）、长视频切短（clip-factory）、播客转视频（podcast-repurpose）、多语字幕与配音（localization-dub）、录屏演示（screen-demo）、档案素材纪录片（documentary-montage）、预告片（cinematic）、主题讲解（animated-explainer / animation）、数字人口播（avatar-spokesperson）。
- 参考视频复刻（混剪 / 预告 / 讲解类）。

## 不适合

- 需要 AI 生成人物表演的社媒视频 → 交给 hypit。
- 只想快速批量出片 → 交给 MoneyPrinterTurbo。

## 安装

- 源码项目：`git clone https://github.com/calesthio/OpenMontage.git <目录>`，默认目录 `~/.shrimp/skills/OpenMontage`。
- **不要用 `npx skills add`**：它会找到内部 `.agents/skills/` 下数十个工具类 skill（2026-10-31 远端 `--list` 显示 89 个，随上游变化），不是入口。
- 依赖：Python 3.10+、FFmpeg，按其 README 安装。

## 交接

- 项目根目录取 `python3 <本 skill 目录>/scripts/registry.py locate OpenMontage`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）输出的 `path`，在该目录工作。
- 先读 `AGENT_GUIDE.md`（`AGENTS.md` 只指向它），按 Rule Zero 走 pipeline：选 pipeline → 读 `pipeline_defs/<pipeline>.yaml` → preflight → 逐阶段读 director skill 后执行。

## 音频

- 内生（ElevenLabs、Piper 等）。
- 用 omnivoice 时：只在调用 TTS 的那一条命令前加 `OPENAI_API_KEY=none OPENAI_BASE_URL=http://127.0.0.1:3900/v1`，显式调用 `openai_tts`，参数：
  - `model: tts-1`（或 `tts-1-hd`）
  - `response_format: wav`
  - `voice` 用 omnivoice 音色 ID
- 实测 2026-10-31 成功生成 12.48 秒 wav。

## 注意

- 这两个变量**不要写进** `.env`：同一进程里 `openai_image` 会被发到 omnivoice（返回 405），preflight 还会把 `openai_image`、`sora_video` 误标为可用。
- 不传 model 时默认 `gpt-4o-mini-tts`，omnivoice 返回 400。
- 机器设有 SOCKS 代理时 Python 环境需要 `socksio`。
