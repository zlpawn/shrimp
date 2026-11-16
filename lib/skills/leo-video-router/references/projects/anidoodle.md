# anidoodle

仓库：https://github.com/alexgreensh/anidoodle

## 适合

- 32 种物理手绘工艺（圆珠笔排线、水墨枯笔、蓝晒蓝图、木刻浮世绘套印、粉笔黑板、剪纸拼贴、刺绣等）。
- 绘画过程与延时动画（Timelapse / 画法教学）：按现实画家落笔顺序逐笔绘制，无淡入淡出。
- 纯代码乐理实时作曲与物理音效（Music & SFX）：零采样、零外部依赖、零版权风险，帧级声画对齐。
- 轻量级网页交互动效：交付自包含单文件离线 HTML（约 100 KB）或 `<ani-doodle>` Web 组件。
- 机械与概念动态解说：会运转、会自己拆解组装的手绘机械结构。

## 不适合

- 真实人物对口型、真人短剧与数字人表演（走 hypit）。
- 已有素材/长视频切片与播客剪辑（走 OpenMontage）。
- 批量信息流营销模板短视频（走 MoneyPrinterTurbo）。

## 安装

- `npx skills add alexgreensh/anidoodle -g -y`
- 环境：Node 20+，ffmpeg（涉及视频与动效时必需），Playwright Chromium。

## 交接

- 从 `python3 <本 skill 目录>/scripts/registry.py locate anidoodle`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）输出的 `entry_dir` 读其 SKILL.md：
  1. 初始化项目：`node "<entry_dir>/engine/tools/scaffold.mjs" <作品目录> --still <名> --film <名> --format <画幅> --duration <秒>`
  2. 单帧审查（先看最难的一帧确认画风）：`node "<entry_dir>/tools/still.mjs" <名> --out out/look.png --scale 2`
  3. 全片自检（验证确定性纯函数与无死帧）：`node "<entry_dir>/tools/gate.mjs" <名>`
  4. 最终导出：MP4 视频 `node "<entry_dir>/tools/render.mjs" <名>`，或自包含离线 HTML `node "<entry_dir>/tools/emit.mjs" <名>`。

## 音频

- 内生，配乐由纯算术乐理实时合成，音效由物理模型计算；不需要外部 BGM 或素材。
- 若需画外旁白，可按 VoiceStudio (原 omnivoice) 标准流程传入 wav 音轨。

## 注意

- 核心绘图函数严格遵循纯函数契约，依赖带种子的伪随机数，每次渲染像素绝对确定。
- 严格遵循 Craft Bar 防劣质规范（禁止简单椭圆拼接人体、禁止无理由死帧）。
