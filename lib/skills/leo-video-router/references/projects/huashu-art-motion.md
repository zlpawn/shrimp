# huashu-art-motion

仓库：https://github.com/alchaincyf/huashu-art-motion

## 适合

- 具名艺术家笔法（梵高、莫奈等）。
- 名画穿越、艺术史速通、长卷换风格。
- YouTube 解说语法（Vox、3b1b、Kurzgesagt、白板、财经图表）片段。
- 拆解复刻动画。

## 不适合

- 口播转写和逐字时间轴：它交给外部管线；完整中文口播讲解交给 dashi-animationstyle。
- 媒介或类型风格优先看 lemo-opuscar。

## 安装

- `npx skills add alchaincyf/huashu-art-motion -g -y`
- 仓库约 77 MB，2026-10-31 首次 clone 因网络中断失败；失败时重试一次。

## 交接

- 从 `python3 <本 skill 目录>/scripts/registry.py locate huashu-art-motion`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）输出的 `entry_dir` 读其 SKILL.md：先分档，再按任务类型读对应 references。
- 交付前跑 `qa.py` 和 `deliver.py`。

## 音频

- 可选。
- 已有录音：先设 `S=<entry_dir>`（它的 `references/capabilities.md` 里 `S` 指 skill 目录），再运行 `python3 "$S/scripts/capabilities.py" use-audio --audio <录音> --out <项目>/音频/口播.wav`（Windows 上用 `python`）。
- omnivoice 生成的 wav 同样走 `use-audio`。
- 它自带的声音路径是 macOS `say` 和火山复刻。

## 注意

- 无声动画不启动语音配置。
