# 知识库第一阶段：多引擎文档解析与双引擎对比工作台设计规范 (Knowledge Base Phase 1 Design Spec)

## 1. 概述与设计目标 (Overview & Goals)

### 1.1 背景与定位
本项目为网关系统扩展（System Extensions）新增一级模块：**「知识库 (Knowledge Base)」**（导航路径：`系统扩展 ➔ 知识库 (Knowledge Base)`，路由 `#knowledge-base`）。
本规范聚焦于知识库**第一阶段（Phase 1）核心地基建设**：专注于多源文档的高保真解析、结构化转换、双引擎对比预览与知识归档，为后续向量化检索（LanceDB）、切片（Chunking）与 RAG 问答提供可靠的结构化数据输入。

### 1.2 核心设计原则 (Design Principles)
* **高扩展性与开闭原则 (Open-Closed Principle, OCP)**：
  * 解析引擎采用**插件化适配器（Engine Adapter）**模式。新增解析引擎（如未来的 MinerU、Unstructured、Pandoc 等）只需实现标准接口并注册，核心调度流水线与 UI 无需修改。
  * 输入源采用**提供者（Ingest Provider）**模式。新增数据源（如本地文件夹监控、S3、网盘导入）对解析与存储透明。
* **高可靠性与沙箱隔离**：
  * 解析进程均采用按需子进程执行，任务执行完毕立即释放 CPU、内存与 GPU 显存，实现**零常驻闲置开销**。
* **数据自包含与防失效**：
  * 所有提取出的结构化文本存入 SQLite，所有图文附件（包括远端网页图片）均做本地化转存，断网离线依然完整可用。

---

## 2. 整体架构与设计模式 (Architecture & Patterns)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       前端 Desktop UI (TypeScript)                          │
│  • desktop/index.html (侧边栏 nav-item: #knowledge-base)                    │
│  • desktop/src/modules/knowledge-base.ts                                   │
│    ├── 知识库目录管理 (Collections Sidebar)                                  │
│    ├── 输入源组件 (Upload / URL + Leo Lantern / Text Paste)                 │
│    ├── 引擎环境状态与一键安装升级组件 (Live Task Logs Modal)                │
│    └── 双引擎对比预览工作台 (MarkItDown vs Docling / [MD | HTML | JSON])    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / REST APIs (/v1/kb/...)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    后端核心网关 (lib/knowledge-base/)                       │
│                                                                             │
│  ┌─────────────────────────┐           ┌─────────────────────────────────┐  │
│  │   Ingest Orchestrator   │           │     Engine Adapter Registry     │  │
│  │   (流水线调度器)         ├──────────►│     (开闭原则：引擎扩展注册中心)    │  │
│  └────────────┬────────────┘           └────────────────┬────────────────┘  │
│               │                                         │                   │
│               ▼                                         ▼                   │
│  ┌─────────────────────────┐           ┌─────────────────────────────────┐  │
│  │  Scraper Strategy Hub   │           │ ┌─────────────┐ ┌─────────────┐ │  │
│  │  • HttpStreamScraper    │           │ │ MarkItDown  │ │   Docling   │ │  │
│  │  • LeoLanternScraper    │           │ │   Adapter   │ │   Adapter   │ │  │
│  │  • GalleryDlScraper     │           │ └─────────────┘ └─────────────┘ │  │
│  └────────────┬────────────┘           └─────────────────────────────────┘  │
│               │                                                             │
│               ▼                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              Knowledge Base Store (SQLite + Local Assets)             │  │
│  │  • kb.db (node:sqlite 原生驱动 + FTS5 全文索引)                       │  │
│  │  • FileSystem Repository (原始文件 raw/ 与附件 assets/)               │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心抽象与开闭原则落地 (Core Abstractions & OCP)

### 3.1 解析引擎适配器规范 (`ParserEngineAdapter`)
任何解析引擎均实现统一接口，新增引擎只需向 `engineRegistry` 注入实例：

```typescript
export interface EngineStatus {
  installed: boolean;
  version: string | null;
  binPath: string | null;
  platformSupport: boolean;
  installCommand: string;
  upgradeCommand: string;
}

export interface ParseOptions {
  docId: string;
  collectionId: string;
  outputDir: string;
  extractImages: boolean;
  ocrMode?: 'auto' | 'force' | 'off';
}

export interface ParseResult {
  engineId: string;
  markdown: string;
  html?: string;
  jsonStructure?: any;
  assets: Array<{
    name: string;
    localPath: string;
    url: string;
    sizeBytes: number;
    mimeType: string;
  }>;
  durationMs: number;
  wordCount: number;
}

export interface ParserEngineAdapter {
  readonly id: string;           // 如 'markitdown' | 'docling' | 'mineru'
  readonly name: string;         // 展示名称
  readonly description: string;  // 适用场景描述
  readonly supportedExtensions: string[];

  detect(): Promise<EngineStatus>;
  install(onLog?: (line: string) => void): Promise<void>;
  upgrade(onLog?: (line: string) => void): Promise<void>;
  parse(inputPath: string, options: ParseOptions): Promise<ParseResult>;
}
```

* **MarkItDown 适配器**：
  * 核心命令：`markitdown <inputPath> -o <outputMd>`。
  * 专长：Word (`.docx`)、Excel (`.xlsx`)、PPT (`.pptx`)、HTML、纯文本等毫秒级提取。
* **Docling 适配器**：
  * 核心命令：`docling <inputPath> --to md --to html --to json --artifacts-path <assetsDir> --output <outputDir>`。
  * 专长：复杂 PDF、多栏论文、扫描件、财务报表、合并单元格表格精准重建、LaTeX 公式提取。
* **后续扩展点**：未来加入其他开源项目（例如 `mineru`、`pandoc`）仅需新增一个 `xxx-adapter.mjs`，在注册表 `registerEngine(new MineruAdapter())` 即可自动生效，前端自动渲染该引擎状态与选项。

### 3.2 网页与图片抓取策略规范 (`ScraperStrategy`)
针对外部网页与图片下载，抽象统一策略路由：

```typescript
export interface ScrapeOptions {
  url: string;
  docId: string;
  preferBrowser?: boolean; // 是否启用 Leo 浏览器增强
}

export interface ScrapedContent {
  title: string;
  html: string;
  text: string;
  assets: Array<{ remoteUrl: string; localPath: string; relativeUrl: string }>;
}

export interface WebScraperStrategy {
  match(url: string): boolean;
  scrape(options: ScrapeOptions): Promise<ScrapedContent>;
}
```

* **策略 1：`HttpStreamScraper`（默认高效流水线）**：
  * 原理：Node.js 原生并发流式请求，提取 DOM 中所有 `<img>` 与 `<figure>`，带目标域名 `Referer` 与合规 `User-Agent` 下载至本地素材目录，并将 HTML/Markdown 对应标签原位重写为本地相对路径。
* **策略 2：`LeoLanternBrowserScraper`（浏览器深度联动）**：
  * 联动本地 `clis/leo-lantern` 与 Leo 浏览器插件：
    1. 自动提取当前域名的有效登录态 Cookie（`leo-lantern cookies --domain <domain>`），注入到 HTTP 下载流中，突破登录墙与防盗链；
    2. 或调用 `leo-lantern goto` / `eval` 在浏览器上下文内执行页面滚动触发懒加载，以 Canvas/Blob 形式捕获图片；
    3. 支持“一键导入当前浏览器正在浏览的标签页”。
* **策略 3：`GalleryDlScraper`（画廊与社交媒体原图增强）**：
  * 针对 Twitter/X、Reddit、Pixiv 等支持的画廊/相册 URL，若检测到本机已安装 `gallery-dl`，则调用 `gallery-dl --cookies ...` 直接拉取无损全分辨率原图素材。

---

## 4. 存储架构与数据库模型 (Storage Architecture & Schema)

### 4.1 混合存储拓扑
* **文件存储**：`data/knowledge-base/`
  * `raw/`：存放用户上传或抓取的原始二进制源文件（按文件哈希重命名：`<sha256>.<ext>`，去重存储）。
  * `files/<doc_id>/assets/`：存放该文档提取出的本地图片、图表切片与附件。
* **SQLite 数据库**：`data/knowledge-base/kb.db`
  * 使用 Node.js 原生 `node:sqlite`（DatabaseSync），轻量、免除额外 C++ 编译依赖。
  * 开启 WAL（Write-Ahead Logging）模式，高并发读写不卡顿。

### 4.2 数据库 Schema 定义

```sql
PRAGMA journal_mode = WAL;

-- 1. 知识库集合表
CREATE TABLE IF NOT EXISTS kb_collections (
  id TEXT PRIMARY KEY,                 -- 集合ID (如 'col_default')
  name TEXT NOT NULL,                  -- 集合名称
  description TEXT DEFAULT '',         -- 描述
  icon TEXT DEFAULT 'folder',          -- 图标名称
  color TEXT DEFAULT '#3b82f6',        -- 主题色
  doc_count INTEGER DEFAULT 0,         -- 关联文档数
  created_at INTEGER NOT NULL,         -- 创建时间戳 (ms)
  updated_at INTEGER NOT NULL          -- 更新时间戳 (ms)
);

-- 2. 文档主表（同时持久化双引擎结果）
CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY,                 -- 文档ID (如 'doc_1741148800000_abcd')
  collection_id TEXT NOT NULL,         -- 所属集合ID
  title TEXT NOT NULL,                 -- 文档标题
  source_type TEXT NOT NULL,           -- 'file' | 'url' | 'text'
  source_url TEXT DEFAULT '',          -- 原始URL
  file_name TEXT DEFAULT '',           -- 原始文件名
  file_path TEXT DEFAULT '',           -- 原始文件存储路径
  file_size INTEGER DEFAULT 0,         -- 文件大小 (字节)
  file_hash TEXT DEFAULT '',           -- SHA256 防重哈希
  
  -- MarkItDown 结果
  markitdown_status TEXT DEFAULT 'idle',      -- 'idle' | 'running' | 'done' | 'failed'
  markitdown_md TEXT DEFAULT '',             -- 生成的 Markdown
  markitdown_html TEXT DEFAULT '',           -- 对应 HTML 视图
  markitdown_duration_ms INTEGER DEFAULT 0,  -- 解析耗时 (ms)
  markitdown_error TEXT DEFAULT '',          -- 异常信息

  -- Docling 结果
  docling_status TEXT DEFAULT 'idle',        -- 'idle' | 'running' | 'done' | 'failed'
  docling_md TEXT DEFAULT '',                -- 生成的 Markdown
  docling_html TEXT DEFAULT '',              -- 生成的 HTML
  docling_json TEXT DEFAULT '',              -- 完整的 DoclingDocument JSON 树
  docling_duration_ms INTEGER DEFAULT 0,     -- 解析耗时 (ms)
  docling_error TEXT DEFAULT '',             -- 异常信息

  -- 公共元数据
  assets_json TEXT DEFAULT '[]',             -- 本地提取图片列表 JSON [{ name, localPath, url, size }]
  word_count INTEGER DEFAULT 0,              -- 统计总字数
  adopted_engine TEXT DEFAULT 'both',        -- 'both' | 'docling' | 'markitdown'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES kb_collections(id) ON DELETE CASCADE
);

-- 3. 全文检索 FTS5 虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS kb_documents_fts USING fts5(
  doc_id UNINDEXED,
  title,
  content
);
```

---

## 5. 前端交互与工作台设计 (UI & UX Design)

### 5.1 页面布局结构
在 `desktop/index.html` 的侧边栏「系统扩展」分组下添加：
```html
<a href="#knowledge-base" class="nav-item" onclick="switchTab('knowledge-base')">
    <svg ...>...</svg>
    知识库 (Knowledge Base)
</a>
```
对应主容器 `<section id="section-knowledge-base" class="section">`：
1. **左侧集合导航栏 (Collections Panel, 宽度 240px)**：
   * 集合列表（名称、图标、文档数、右键/菜单重命名与删除）；
   * 底部「+ 新建知识库」按钮。
2. **中间文档列表栏 (Document List Panel, 宽度 300px)**：
   * 搜索框（触发 FTS5 秒级全文检索）；
   * 来源过滤（全部 / 文件 / 网页 / 文本）；
   * 文档卡片（标题、格式图标、创建时间、双引擎状态徽章、字数）。
3. **右侧双引擎对比工作台 (Workbench Pane, 自适应宽度)**：
   * **顶栏控制台**：
     * 解析引擎状态指示灯与快捷安装/更新按钮；
     * 输入动作区：[ 📂 上传文件 ] [ 🌐 抓取网页 (支持 Leo 联动) ] [ 📝 粘贴文本 ]；
     * 视图格式切换器：`[ 🔘 Markdown | 🔘 HTML | 🔘 JSON ]`；
     * 视图模式切换：`[ ⫴ 分屏双栏对比 | 📄 仅看 MarkItDown | 📑 仅看 Docling ]`。
   * **工作台主体（分屏双栏）**：
     * **左半屏（MarkItDown）**：展示执行耗时标签（如 `⚡ 0.23s`）、渲染结果、源码查看切换开关、一键导出按钮；
     * **右半屏（Docling）**：展示执行耗时标签（如 `🧠 2.41s (CUDA)`）、复杂表格还原高亮、渲染结果、源码查看切换开关、一键导出按钮。
   * **底部/侧边素材抽屉 (Extracted Assets Drawer)**：
     * 缩略图展示当前文档提取出的所有图片与图表，支持原图预览与一键打包下载。

### 5.2 异步安装升级与进度感知组件
* 点击「安装 Docling / MarkItDown」或「检查更新」时：
  * 后端提交任务至 `TaskQueue`，执行 `uv tool install/upgrade <tool>`；
  * 页面弹出带有暗黑终端风格的 **实时进度抽屉 / Modal**；
  * 前端以 1 秒间隔轮询/流式拉取进度百分比与终端标准输出行，实时滚动展示下载进度，确保用户知晓当前状态。

---

## 6. RESTful API 接口规范 (API Spec)

统一挂载于 `/v1/kb/...`：

| 接口 | 方法 | 请求参数 / Body | 响应数据 |
| :--- | :--- | :--- | :--- |
| `/v1/kb/tools/status` | GET | 无 | `{ tools: { docling: EngineStatus, markitdown: EngineStatus, galleryDl: EngineStatus, leoLantern: EngineStatus } }` |
| `/v1/kb/tools/install` | POST | `{ "tool": "docling" \| "markitdown" }` | `{ "taskId": string, "status": "pending" }` |
| `/v1/kb/tools/upgrade` | POST | `{ "tool": "docling" \| "markitdown" }` | `{ "taskId": string, "status": "pending" }` |
| `/v1/kb/collections` | GET | 无 | `{ "collections": KbCollection[] }` |
| `/v1/kb/collections` | POST | `{ "name": string, "description"?: string, "icon"?: string }` | `{ "collection": KbCollection }` |
| `/v1/kb/collections/:id` | DELETE | 无 | `{ "ok": true }` |
| `/v1/kb/documents` | GET | `?collection_id=&q=&limit=&offset=` | `{ "documents": KbDocumentSummary[], "total": number }` |
| `/v1/kb/documents/:id` | GET | 无 | `{ "document": KbDocumentDetail }` |
| `/v1/kb/documents/:id` | DELETE | 无 | `{ "ok": true }` |
| `/v1/kb/ingest/file` | POST | `multipart/form-data` (`file`, `collection_id`) | `{ "taskId": string, "documentId": string }` |
| `/v1/kb/ingest/url` | POST | `{ "url": string, "collection_id": string, "use_leo"?: boolean }` | `{ "taskId": string, "documentId": string }` |
| `/v1/kb/ingest/text` | POST | `{ "text": string, "title": string, "collection_id": string }` | `{ "taskId": string, "documentId": string }` |
| `/v1/kb/files/:id/assets/:filename` | GET | 路径参数 | 图片文件二进制流（带正规 MIME 与缓存头） |

---

## 7. 错误处理与降级机制 (Error Handling & Resilience)

1. **引擎缺失降级**：
   * 若只安装了 `markitdown`，用户解析文档时系统标记 `docling_status = 'skipped'` 并提示安装，正常展示 MarkItDown 解析结果；
   * 若两者均未安装，在上传区域显著提示一键安装指南，禁止无效解析提交。
2. **Docling 超时与内存防护**：
   * 单文档设置可配置的超时上限（默认 120 秒），防止超长异常 PDF 挂起子进程；
   * 解析异常时捕获错误栈至 `docling_error` 字段，不中断主网关服务。
3. **网页抓取防盗链回退**：
   * 单张图片下载如果遇到 404 或超时，记录 warn 日志，保留原始 URL 或占位说明，确保整篇文章的正文解析顺利完成。

---

## 8. 实施与分步验证计划 (Verification Plan)

### 8.1 自动化单元测试
1. **Engine Manager 探测与适配器测试**：
   * 运行 `node --test tests/unit/kb-engine-adapter.test.mjs`，验证引擎安装状态探测、命令拼装逻辑。
2. **Store 数据库读写与 FTS5 测试**：
   * 运行 `node --test tests/unit/kb-store.test.mjs`，验证集合增删改查、双版本字段持久化、全文检索。
3. **Web Scraper 与图片本地化测试**：
   * 运行 `node --test tests/unit/kb-scraper.test.mjs`，测试 HTML DOM 解析、图片提取、链接本地重写。

### 8.2 手动集成验证
1. 在桌面管理端「系统扩展」进入「知识库」Tab，验证集合创建与展示。
2. 分别上传 `.docx`、带图复杂 `.pdf`、以及提交网页 URL，观察双引擎解析执行过程与耗时。
3. 验证分屏对比视图：测试 Markdown 渲染（图片正常加载）、HTML 渲染、JSON 树形结构展示。
4. 测试「一键安装 / 升级」功能，观察终端日志滚动是否正常。
