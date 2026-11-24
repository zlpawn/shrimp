# 决策与模态分流表 (Decision Tables)

本表定义 `leo-to-skill-router` 如何根据用户输入的材料类型与场景，将制作任务分流到最佳底层管线。

---

## 1. 核心分流规则矩阵

| 输入材料特征 | 匹配模式 | 核心分流管线 | 推荐参数 / 注意事项 |
| :--- | :--- | :--- | :--- |
| **PDF 文件** (`.pdf`) | 文档模式 | `book-to-skill` | 技术书建议 `--mode technical`（调用 Docling 保留表格和代码）；散文建议 `--mode text` |
| **电子书** (`.epub`, `.mobi`, `.azw3`) | 文档模式 | `book-to-skill` | 快速解包，自动按章节切片 |
| **Markdown / 文本** (`.md`, `.txt`, `.adoc`, `.rst`) | 文档模式 | `book-to-skill` | 零依赖秒级提取，优先保持 `#` 标题层级 |
| **文档文件夹 / Glob 通配** (`docs/`, `**/*.md`) | 文档模式 | `book-to-skill` | 自动聚合并按文件名排序合并处理 |
| **网络视频 URL** (B站, YouTube, 抖音等) | 课程模式 | `leo-lesson-to-skill` | 调度 `yt-dlp` 下载音频并提取字幕/ASR 转写 |
| **本地音视频** (`.mp4`, `.mov`, `.wav`, `.mp3`) | 课程模式 | `leo-lesson-to-skill` | 提取 ASR 转写 + 关键帧多模态/OCR |
| **书籍 + 配套视频同时提供** | 复合融合模式 | **Fusion Pipeline** | 以书籍构建 `SKILL.md` 知识大纲，以视频作为 `Worked Examples` 案例 |

---

## 2. 输出与中间件路径决策

| 路径配置项 | 默认值 | 来源与修改方式 | 作用说明 |
| :--- | :--- | :--- | :--- |
| **最终技能输出路径** | `<shrimp_root>/lib/skills/<slug>/` | `~/.shrimp/skills/leo-to-skill-router/config.json` (`output_skills_dir`) | 默认直接生成至当前项目库，无缝成为 shrimp 原生技能 |
| **中间提取物暂存路径** | `~/素材/to-skill/<slug>/` | `~/.shrimp/skills/leo-to-skill-router/config.json` (`artifacts_dir`) | 存放中间提取的音频流、转写字幕、分块文本与大纲元数据 |
| **Python 虚拟环境** | `~/.shrimp/skills/leo-to-skill-router/.venv` | `~/.shrimp/skills/leo-to-skill-router/config.json` (`python_venv_path`) | 隔离所有文档与视频提取相关 Python 依赖（由 `uv` 维护） |

---

## 3. 容错与降级策略

1. **扫描件 PDF 拦截**：
   - 若 PDF 提取时检测到纯图片（无文本层），提示用户先使用 `ocrmypdf <in.pdf> <out.pdf>` 处理，再重新执行。
2. **缺失 `book-to-skill` 引导**：
   - 触发 JIT 安装卡片：`npx skills add virgiliojr94/book-to-skill`。
3. **缺失 `ffmpeg` 或 `yt-dlp`**：
   - 课程视频下载与转写必须依赖 `ffmpeg`；若缺失，停止并引导用户安装（如 `brew install ffmpeg yt-dlp`）。
