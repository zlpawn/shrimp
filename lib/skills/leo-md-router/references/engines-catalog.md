# 下游文档解析引擎档案（engines-catalog）

本档案记录 `leo-md-router` 首批纳管的两个文档解析引擎：**`docling`** 与 **`markitdown`**。
`SKILL.md` 在以下时机按需读取本文件对应 `## <engine>` 小节：
1. **质量优先路由决策**：对比两者在当前文件类型与复杂度下的产出效果；
2. **安装 / 更新引导**：生成准确的 `uv tool` 与 Skill 安装、升级命令；
3. **兜底直接执行**：当环境尚未安装独立 Skill 或用户选择 `uvx` 临时运行时，按本档案的标准命令执行并做质量校验。

---

## docling

- **一句话**：IBM 开源的高精度文档理解引擎，擅长复杂排版 PDF、扫描件 OCR、表格结构还原、VLM 视觉解析与结构化导出。
- **能力画像（最适合的场景）**：
  - **版面复杂或扫描型 PDF**（多栏排版、学术论文、研报、含跨页/合并单元格表格、公式、扫描件/图片型 PDF）：基于版面分析（Layout）、阅读顺序恢复与 `TableFormer` 表格结构识别，Markdown 表格与标题层级远优于纯文本流提取；
  - **图片文字/图表提取**（`.png` / `.jpg` / `.jpeg` / `.tiff` / `.webp`）：支持 OCR 与 `--pipeline vlm`；
  - **复杂 Office 文档**（含复杂表格与图文混排的 `.docx` / `.pptx` / `.xlsx`）：结构还原更完整；
  - **高阶结构化需求**：需要同时输出无损 `DoclingDocument` JSON、按标题语义分块（RAG `HybridChunker`）、提取结构化字段（`DocumentExtractor`）或导出表格 DataFrame/CSV。
- **支持格式**：`pdf`、`docx`/`doc`、`pptx`/`ppt`、`xlsx`/`xls`、`html`、`md`、`asciidoc`、`csv`、`odt`/`ods`/`odp`、图片、音频/视频（ASR）、多种 XML（JATS/USPTO/XBRL），以及 `http(s)` URL。
- **依赖体量提醒**：完整版 `docling` 会拉取 PyTorch 与本地版面/表格/OCR 模型，安装与首次下载模型占用较大磁盘与时间；若仅需普通文本 PDF + CLI 且不想拉 PyTorch，可选 `uv tool install "docling-slim[format-pdf,cli]"`。
- **Skill 信息**：
  - 随官方 Python 包内置于 `docling/.agents/skills/docling/`（仓库：`https://github.com/docling-project/docling`）。
  - 安装 / 同步 Skill 到中央库（macOS / Linux）：
    ```bash
    # 从已安装的 docling 环境定位并复制到 ~/.agents/skills/docling
    DOCLING_SKILL_SRC=$(uv tool run --from docling python -c "import importlib.util, pathlib; print(pathlib.Path(importlib.util.find_spec('docling').origin).parent / '.agents/skills/docling')")
    rm -rf ~/.agents/skills/docling && cp -R "$DOCLING_SKILL_SRC" ~/.agents/skills/docling
    ln -sfn ~/.agents/skills/docling ~/.gemini/config/skills/docling
    ```
- **CLI 安装 / 更新 / 临时运行**：
  - 安装 CLI：`uv tool install docling`
  - 更新 CLI：`uv tool upgrade docling`（升级后建议同步更新 `~/.agents/skills/docling`）
  - 零安装临时兜底：`uvx --from docling docling "<input>" --to md --output "<docDir>"`
- **常用高质量命令模板**：
  ```bash
  # 标准高精度转 Markdown（带表格与 OCR）
  docling "<input>" --to md --output-file "<outputMdPath>"

  # 同时保留无损结构化 JSON（用户需要深度解析或二次加工时）
  docling "<input>" --to md --to json --output "<docDir>"

  # 复杂版面 / 手写体 / 密集公式 / 多栏乱序 → 升级 VLM 管线
  docling "<input>" --pipeline vlm --to md --output-file "<outputMdPath>"

  # macOS 原生高速 OCR（针对扫描件）
  docling "<input>" --ocr-engine ocrmac --to md --output-file "<outputMdPath>"
  ```
- **产出质量校验清单**：
  - 若生成的 Markdown 近空、缺少预期表格或出现大量 `` 乱码，优先检查是否为扫描件并启用 OCR 或切换 `--pipeline vlm`。

---

## markitdown

- **一句话**：Microsoft 开源的轻量级多格式转 Markdown 工具，无 PyTorch 重依赖，对电子书、邮件、压缩包、网页与常规结构化文件转换极快且干净。
- **能力画像（最适合的场景）**：
  - **Docling 未覆盖或 MarkItDown 专精的格式**：`.epub` 电子书、`.msg` Outlook 邮件、`.zip` 压缩包递归解包转换、`.ipynb` Notebook、YouTube 视频链接字幕提取；
  - **结构规整的纯文本/标记类输入**：HTML 网页文章、结构简单的 `.docx` / `.pptx` / `.xlsx` / `.csv` / `.json` / `.xml`，能输出非常清爽、极少冗余标记的 Markdown；
  - **轻量环境**：不依赖 GPU / PyTorch，秒级安装与运行。
- **短板与实测切换提醒**：
  - 对 **复杂 PDF（多栏、无线/跨页复杂表格、扫描件、数学公式）** 的还原能力通常显著弱于 `docling`；但若遇到极简单纯文本 PDF 且本机仅装了 `markitdown`，可先试跑并按质量检查清单核验，不达标立即切 `docling`。
- **依赖体量提醒**：`markitdown[all]` 体积轻量，无 PyTorch；支持各格式扩展（含 `outlook`、`pdf`、`docx`、`pptx`、`xlsx`、`youtube-transcription` 等）。
- **Skill 信息**：
  - 官方仓库 `https://github.com/microsoft/markitdown` 本身未内置 `SKILL.md`；可选社区 Skill：`https://github.com/raccioly/markitdown-skill`（或直接由 `leo-md-router` 按本档案调度 CLI）。
  - 若用户选择安装社区 Skill：
    ```bash
    git clone --depth 1 https://github.com/raccioly/markitdown-skill.git /tmp/markitdown-skill
    cp -R /tmp/markitdown-skill/markitdown ~/.agents/skills/markitdown
    ln -sfn ~/.agents/skills/markitdown ~/.gemini/config/skills/markitdown
    rm -rf /tmp/markitdown-skill
    ```
- **CLI 安装 / 更新 / 临时运行**：
  - 安装 CLI：`uv tool install "markitdown[all]"`
  - 更新 CLI：`uv tool upgrade markitdown`
  - 零安装临时兜底：`uvx "markitdown[all]" "<input>" -o "<outputMdPath>"`
- **常用高质量命令模板**：
  ```bash
  # 转换文件并输出到指定路径
  markitdown "<input>" -o "<outputMdPath>"

  # 转换 YouTube 链接提取字幕文本
  markitdown "https://www.youtube.com/watch?v=..." -o "<outputMdPath>"
  ```
- **产出质量校验清单**：
  - 若对 PDF/Office 使用 `markitdown` 后发现段落顺序错乱、表格退化成散落文本或扫描页为空，**立即改用 `docling` 重新转换**以保证质量。
