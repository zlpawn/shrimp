# 中间提取物暂存规范 (Artifacts Spec)

本规范定义制作过程中产生的中间过程产物（提取文本、转写、音视频切片、关键帧等）在 `artifacts_dir` 下的目录与时序命名标准。

---

## 1. 命名与时序结构标准

遵循 shrimp 生态（如 `leo-xhs-router`、`leo-obs-studio`、`leo-md-router`）的时序落盘规范，每次抽取任务在暂存目录下生成**带当天日期前缀**的独立工程沙箱：

```text
~/素材/to-skill/YYYY-MM-DD-<slug>/
```

> **什么是 `<slug>`？**
> `slug` 指的是**该技能在系统中的标准英文唯一代号/短名称**（纯小写英文、数字与连字符，如 `ddia`、`clean-architecture`、`fastapi-pro`）。
> 例如 2026年11月24日 提取《Clean Architecture》，目录名为：
> `~/素材/to-skill/2026-11-24-clean-architecture/`

---

## 2. 详细子目录布局

### 2.1 文档/书籍模式 (`book-to-skill`)
```text
~/素材/to-skill/YYYY-MM-DD-<slug>/
├── manifest.json              # 运行清单（来源文件、SHA256指纹、Token消耗、耗时）
├── full_text.txt              # 提取出的结构化全文（含 Markdown 代码块/表格）
├── metadata.json              # 章节切分与行号索引（start_line/end_line，用于REPL单章切片读取）
└── sources/ (可选)            # 源文件校验副本或软链
```

### 2.2 课程/视频模式 (`leo-lesson-to-skill`)
```text
~/素材/to-skill/YYYY-MM-DD-<slug>/
├── manifest.json              # 阶段状态（acquired -> transcribed -> methodology -> ...）
├── transcripts/               # 【轻量文本层】转写字幕与带时间戳文本（永久保留，<2MB）
│   ├── raw.srt / raw.vtt
│   └── transcript_segments.json
├── ir/                        # 【知识表征层】中间结构与方法论初稿（永久保留，<1MB）
│   ├── intermediate-representation.json
│   └── methodology.json
├── media/                     # 【重型媒体层】下载与抽取的音视频（按需清理，100MB~2GB）
│   ├── source.info.json       # 视频标题、简介、URL 等元数据
│   ├── original.mp4           # 原始视频（可清理）
│   └── audio.wav              # 提取出的无损音频流（供ASR用，可清理）
└── frames/                    # 【视觉证据层】代表帧与PPT截图（按需清理）
    ├── FRAME-0001.png
    └── ocr_evidence.json
```

---

## 3. 冷热分层与清理策略

* **高价值轻量文本（长期保留）**：`full_text.txt`、`metadata.json`、`transcripts/`、`ir/`（总大小通常 < 5MB）。
  * 价值：当下游 Skill 需要增量更新、追加新章节或回溯排查幻觉时，**无需重复执行耗时的 OCR/Docling 或 ASR 语音识别**，直接秒级重跑！
* **重型媒体与帧（按需清理）**：`media/*.mp4`、`media/*.wav`、`frames/*.png`。
  * 策略：由 `config.json` 中的 `auto_clean_media`（布尔值）控制；设为 `true` 时，在 Skill 成功发布到目标目录后自动清除这些大文件。
