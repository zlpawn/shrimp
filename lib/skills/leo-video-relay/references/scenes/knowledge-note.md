---
name: knowledge-note
when: 把视频沉淀成知识笔记、技术或架构笔记、系统设计笔记，或存到 Craft
output: 产出/知识笔记.md
---

# 知识笔记

Write `产出/知识笔记.md` with these parts, in this order.

```markdown
---
title: 中文主题
---
# 中文主题

## 一句话结论
讲者最核心的主张，带时间戳。

## 讲者的方案
按讲者的顺序重建逻辑、架构或步骤。适合画结构时用代码块画 ASCII 图，
只放视频里出现过的节点，看不清的字写 [?]。

## 关键内容
每条一个要点，标注来源层级：
- 📌 事实：……（FACT-0012，04:15）
- 💡 推导：……（依据 FACT-0012、FACT-0015）
- 🛠️ 延伸：……（Agent 补充，非讲者原方案）

![图 1：说明](../frames/FRAME-0058.jpg)

## 未确认
facts.json 里的 unconfirmed，原样保留。

## 来源
视频标题、作者、链接或本地路径、video_id、事实包状态。
```

- 📌 lines come straight from `facts.json` and cite a FACT id.
- 💡 and 🛠️ lines say they are inference or extension, so they are never read as the speaker's view.
- Use a frame where the picture carries information text can't: diagrams, code, whiteboards. Put each image on its own line.
- If the status is `partial`, state the limitation under the title.

## Saving to Craft

Run this when the user asks for Craft, or when the type's route has a `knowledge_target`:

```bash
node <skillDir>/scripts/relay.mjs sync-craft <输出目录> --note <输出目录>/产出/知识笔记.md
```

It returns the document link. Frames upload only for publicly available web videos, because uploaded images open without login. Add `--upload-frames` when the user wants them uploaded anyway.

For any status other than `synced`, tell the user the note is only local or incomplete, and include the reason.
