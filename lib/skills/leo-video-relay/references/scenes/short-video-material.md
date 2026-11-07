---
name: short-video-material
when: 用视频做短视频、切片、混剪、二次剪辑的素材
output: 产出/短视频素材/
---

# 短视频素材

This scene produces material, not a finished video. Pass the folder to `leo-video-router` or `leo-capcut` when the user wants the finished video.

Write `产出/短视频素材/素材包.md` with these parts, in this order:

1. **一句话内容**：这个视频到底说了什么。
2. **可剪片段**：表格，列为 开始、结束、时长、台词原文、画面、用途（钩子/论点/证据/结尾）、证据 ID。时间对齐到完整句子，并避开镜头切换中间。
3. **成片结构**：1 到 3 个方案，每个按顺序列出片段编号和预计时长。
4. **需要补的内容**：原片缺什么（旁白、字幕、配图），分别怎么补。
5. **不能用的**：`unconfirmed` 里的内容，以及人脸、品牌、音乐和原作者版权风险。

## Cutting clips

Cut files only when the user asks. Clips go in `产出/短视频素材/clips/`. The source is `video.source_file` under the output directory, or `video.local_path` in `facts.json`. If neither exists, say the original video is gone and stop cutting.

```bash
ffmpeg -ss <开始秒> -to <结束秒> -i <原视频> -c:v libx264 -c:a aac <输出目录>/产出/短视频素材/clips/<编号>.mp4
```
