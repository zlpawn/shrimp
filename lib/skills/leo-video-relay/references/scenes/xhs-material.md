---
name: xhs-material
when: 用视频做小红书内容、图文笔记的素材，或要选题角度、金句、配图
output: 产出/小红书素材/
---

# 小红书素材

This scene produces material, not a finished post. Pass the folder to `leo-xhs-router` when the user wants the finished post.

Write `产出/小红书素材/素材包.md` with these parts, in this order:

1. **一句话内容**：这个视频到底说了什么。
2. **选题角度**：3 个，各写目标读者、读者为什么想看、依据哪些 FACT。把最推荐的放第一个并说明理由。
3. **钩子候选**：5 条以内。视频原话或原始数字优先，每条带时间戳和证据 ID。改写过的标“改写”。
4. **可引用的干货**：步骤、数字、对比、清单，每条带 FACT id。
5. **配图候选**：`frames/` 里最能撑起封面或内页的帧，写明帧 ID、时间、画面内容、适合放哪一页。把选中的帧复制到 `产出/小红书素材/图/`。
6. **不能写的**：`unconfirmed` 里的内容，以及画面中的人脸、品牌、水印和原作者版权风险。

The test for each item: could someone write a post from this pack without watching the video, and could they trace every claim back to the video?
