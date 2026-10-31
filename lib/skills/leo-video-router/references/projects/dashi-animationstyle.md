# dashi-animationstyle

仓库：https://github.com/chuspeeism/dashi-animationstyle

## 适合

- 15–60 秒中文知识口播 → 1920×1080 风格讲解动画，带字幕，能直接拖进剪映。
- 7 套风格：扁平流程图、手绘笔记、复古报刊、复古剪纸、超现实拼贴、立体卡通、黑底科技。
- 照参考图做新风格；用文字描述出 2–3 个方向。

## 不适合

- 超过 60 秒（要分段）。
- 配乐、音效、真人画面穿插（回剪映做）。

## 安装

- `npx skills add chuspeeism/dashi-animationstyle -g -y`
- 环境：macOS、Node 22+、ffmpeg、Google Chrome，whisper-cpp 可选。

## 交接

- 从 `python3 <本 skill 目录>/scripts/registry.py locate dashi-animationstyle`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）输出的 `entry_dir` 读其 SKILL.md，按用法一执行：
  1. `node "<entry_dir>/pipeline/新建作品.mjs" <作品目录> --style <风格> --audio <口播文件> [--script <稿子.txt>]`
  2. `node "<entry_dir>/pipeline/字幕.mjs" <作品目录>`
  3. 分镜确认 → 3 张静帧确认 → 出片。

## 音频

- **必须先有口播**，`--audio` 必填。
- 用户没有录音时：omnivoice 生成 wav 作为 `--audio`，同时把文案存为稿子传 `--script`。
- 它没有自带 TTS。omnivoice 不可用、用户又不想启动 VoiceStudio 时，回到用户：请用户录音、启动 VoiceStudio，或明确同意用别的 TTS；不要擅自用 edge-tts 或任何云端 TTS。

## 注意

- 一次约 30 分钟到 1 小时，中间停两次请用户确认。
