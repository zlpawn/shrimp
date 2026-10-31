# xilo-opus-video

仓库：https://github.com/Kianzzz/xilo-opus-video

## 适合

- 不限风格的代码视频；先出三个方案和预览再做。
- 按用户给的音乐测节拍卡点。
- 给视频模型生成的绿幕人物搭代码场景。
- Manim / Remotion / HyperFrames。
- 只要 `brief.md` 提示词。

## 不适合

- 写实画面（需要视频模型）。
- 在剪映、PR、AE 里剪辑现成素材；给已有视频加字幕。
- 产品宣传片优先交给 video-shotcraft。

## 安装

- `npx skills add Kianzzz/xilo-opus-video -g -y`

## 交接

- 从 `python3 <本 skill 目录>/scripts/registry.py locate xilo-opus-video`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）输出的 `entry_dir` 读其 SKILL.md，按六步执行：`check_env.py` → 问清需求 → 三个方案 → 预览 → `brief.md` → 制作与验收。
- 工作目录 `opus-video/<slug>/`。

## 音频

- 可选，默认代码合成配乐、不配音。
- 配音接 edge-tts、Kokoro 或用户自己的语音；omnivoice 配音按用户语音交给它。

## 注意

- 绿幕人物可先用环境里的视频生成 skill 生成纯绿幕片段，再交给它抠像合成。
