---
name: leo-article-relay
description: "全能文章高保真脱机归档、知识库持久化与多端（Craft/Obsidian）高保真中继同步引擎。突破腾讯防盗链与反爬验证，全量并发下载高清原图与原生内联 CSS，生成 100% 离线脱网可读的 HTML 原文与清洗后的结构化 Markdown（含 Frontmatter、表格重构与代码块）。支持 Obsidian Vault 智能持久化路由、~/.shrimp 保底存储、以及 1:1 逐字无损直传 Craft 官方云端 CDN 图床的中继同步。Use when user asks to '下载公众号文章', '抓取微信文章', '微信文章转HTML', '保存公众号文章', '同步文章到Craft', '同步到知识库', 'article relay', '剪藏文章', '中继同步', provides article URLs (mp.weixin.qq.com, etc.), or wants to relay articles into Obsidian/Craft."
metadata:
  version: "1.2.0"
  author: "Leo"
---

# Leo Article Relay (全能文章高保真归档与知识中继引擎)

专为长文、公众号与技术博客深度打造的知识摄取与多端中继 Skill。一键突破反爬防护与图片防盗链，秒级直取服务端原生内容，提供 **「像素级脱网 HTML」**、**「结构化 Markdown」** 与 **「Craft 官方图床直传中继」** 多端交付。

---

## 核心特性与交付物

每次抓取均自动在输出目录下创建独立规范的专有文件夹（命名规则：`YYYY-MM-DD-文章标题-公众号名`）：

```text
wechat-articles/
└── 2026-07-24-分解一座冰山：后端系统「AI 知识库体系」建设实践-阿里技术/
    ├── article.html             # 🌐 [交付 1] 100% 像素级离线原版 HTML（本地双击即看，脱网无损排版）
    ├── index.md                 # 📄 [交付 2] 结构化 Markdown（含 Frontmatter、GFM 表格、代码高亮）
    └── images/                  # 🖼️ [交付 3] 本地全量高清原图库（无损防盗链下载）
        ├── img_001.png
        ├── img_002.png
        └── ...
```

### 1. 🌐 像素级离线 HTML (`article.html`)
- **全量内联 CSS**：并发下载微信官方全部 20+ 个 CSS 样式表并直接内联进 `<style>`，彻底杜绝 `file://` 协议下相对路径报错（`net::ERR_INVALID_URL`）导致的排版崩塌。
- **脱机防盗链原图**：全面识别 `<img>`（`data-src` / `src`）以及内联样式的 `background-image`，自动替换为本地相对路径 `images/img_XXX.png`。
- **无报错纯净 DOM**：彻底剔除导致本地 CORS 报错的 `modulepreload`、`preload`、`dns-prefetch` 和远程脚本。
- **解除隐藏与优雅阅读**：微信默认强制给 `#js_content` 附加了 `visibility: hidden; opacity: 0;`，本引擎强制解除隐藏，并注入 760px 宽度自适应与优雅居中布局。
- **元信息补齐**：自动提取并在页面顶部注入准确的发布日期（`publish_time`）、显式作者信息及「🔗 原文链接」。

### 2. 📄 结构化知识库 Markdown (`index.md`)
- **原生 YAML Frontmatter**：包含 `title`, `author`, `date`, `source`, `tags` 等规范字段，专供 Obsidian / Craft / AI RAG 知识库摄取。
- **微信特色排版清洗**：
  - 自动缝合被切断的章节序号与大标题（如孤立的 `01` 与下行标题整合为 `## 01 标题`）。
  - 将秀米/壹伴等基于 `section[data-mpa-table]` 的 flex 假表格重构为标准 GFM Markdown 表格。
  - 剔除底部关注二维码、微信点赞在看卡片与广告噪音。
- **图片双链支持**：默认标准 Markdown 格式，亦支持 Obsidian 双链语法（`![[img_001.png]]`）。

### 2. 知识库目录规范与中枢存储机制 (Storage & Vault Hierarchy)

为了避免将爬取的文章散落在临时的代码工程中，本 Skill 采用严格的 **「本地中枢与知识库持久化路由」** 架构：

- **本地技能专有目录（保底存储）**：
  `~/.shrimp/skills/leo-article-relay/articles/`
  所有未配置外部知识库的文章均统一存放在此，彻底与开发代码仓库隔离。
- **外部知识库持久化配置文件**：
  `~/.shrimp/skills/leo-article-relay/vault`
  记录用户指定的 Obsidian Vault 或自定义知识库完整绝对路径。

#### 首次运行询问与路由逻辑 (Agent 交互 SOP)：
1. **检查配置**：检查 `~/.shrimp/skills/leo-article-relay/vault` 是否存在。
2. **主动询问（若未配置）**：
   - 首次使用时，Agent 主动询问用户：“请问你的知识库目录在哪里？文章希望沉淀到哪个文件夹下？（如：`~/Documents/Obsidian Vault/Articles`）”
   - 将用户指定的目录写入 `~/.shrimp/skills/leo-article-relay/vault`，后续所有 Agent 调用均可直接复用，无需重复询问。
   - 若用户无独立知识库，则默认使用 `~/.shrimp/skills/leo-article-relay/articles/`。
3. **查看与重设命令**：
   ```bash
   # 查看当前配置的知识库路径
   node wechat-dl.mjs --get-vault

   # 手动设置/修改知识库路径
   node wechat-dl.mjs --set-vault "~/Documents/Obsidian Vault/Articles"
   ```

---

## 常用 CLI 命令

脚本位于：`/Users/pa/.agents/skills/leo-article-relay/scripts/wechat-dl.mjs`

### 1. 抓取单个或多个微信文章链接（自动路由到配置的知识库或 ~/.shrimp）
```bash
node /Users/pa/.agents/skills/leo-article-relay/scripts/wechat-dl.mjs "<url1>" ["<url2>"]
```

### 2. 显式指定输出目录
```bash
node /Users/pa/.agents/skills/leo-article-relay/scripts/wechat-dl.mjs "<url1>" -o /path/to/custom/dir
```

### 2. 从链接清单文本文件中批量抓取
```bash
node /Users/pa/.agents/skills/leo-wechat-to-html/scripts/wechat-dl.mjs -f links.txt -o ./wechat-articles
```

### 3. 从终端管道或标准输入（Stdin）抓取
```bash
cat article_urls.txt | node /Users/pa/.agents/skills/leo-article-relay/scripts/wechat-dl.mjs -s -o ./wechat-articles
```

### 4. 与 Craft 笔记深度联动（一阶段 -> 二阶段桥梁）
当用户指示“抓取某篇 Craft 笔记中的所有微信文章”时：
1. Agent 调用 `craft_read` MCP 工具读取目标 Craft 笔记正文；
2. 提取文本中出现的 `https://mp.weixin.qq.com/s/...` 链接；
3. 直接调用 CLI 脚本批量保存至本地：
```bash
node /Users/pa/.agents/skills/leo-article-relay/scripts/wechat-dl.mjs "<extracted_url1>" "<extracted_url2>" -o ./wechat-articles
```

---

## 微信文章全量同步至 Craft 知识库标准工作流 (Craft Sync Pipeline)

当用户要求将微信文章**誊抄/同步到 Craft 笔记**时，必须严格遵守以下 **1:1 原文保真与原生图床上传标准**，**严禁自行压缩概括或摘要技术内容**。

### 1. 核心工作原理与避坑原则

1. **零删减、零摘要**：技术文章与实战教程必须全文 1:1 逐字逐句誊抄，完整保留所有代码注释、LaTeX 公式、数据表格与排版细节。
2. **原生图片自动上传机制**：
   - ⚠️ **切勿直接传本地相对路径**（如 `![](images/img_001.png)`）：Craft 服务端无法访问本地硬盘，会导致图片显示损坏。
   - ✅ **必须使用原始公网图床 URL**（如 `https://mmbiz.qpic.cn/...`）：当向 Craft 发送带有公网 URL 的 Markdown 图片标记时，Craft 后端会**自动抓取图片并转存到 Craft 官方 CDN**，并在笔记中生成真正的原生 Image Block（`uploaded: true`）。
3. **分块注入防超时与截断 (Chunking)**：
   - 长文切勿单次全部传入，单次 `blocks add` 限制在 **<= 12KB**（约 20~40 个 Block），按 `##` 或 `###` 章节边界切割，杜绝 CLI 超时或截断。
4. **特殊字符与命令语法防护**：
   - Python 代码中的多行注释三引号（`"""`）会提前闭合 Craft CLI 的 `--markdown "..."` 参数，导致命令解析失败。必须在预处理时规范化为单引号 `'''` 或 `#` 单行注释。
   - 避免在命令中未转义分号 `;`，防止被 Craft 识别为批量命令分隔符。

---

### 2. 自动化执行 SOP（四步法）

#### Step 1: 准备分块与图床映射
运行切片预处理脚本，自动反解公网图床 URL、清理 Frontmatter、转义特殊字符并切分文件：
```bash
node /Users/pa/.agents/skills/leo-article-relay/scripts/prepare-craft-chunks.mjs "<articleDir>"
```
输出：`<articleDir>/craft-chunks/` 包含切片文件 `chunk_01.md`, `chunk_02.md` ... 及 `manifest.json`。

#### Step 2: 定位目标文件夹并在 Craft 中创建文档
```bash
# 1. 查找或创建目标专栏文件夹（如 "微信公众号文章"）
folders list --filter "微信公众号文章"

# 2. 在该文件夹下创建文档
documents create --title "<文章标题>" --folder <folderId>
# 记录返回的 rootBlockId（如 b7ee59e7-55c1-0af3-34d8-a21c02436b14）
```

#### Step 3: 按序追加切片块 (Blocks Add)
按顺序读取 `chunk_XX.md` 内容，依次调用 `craft_write` MCP 工具：
```bash
blocks add --id <rootBlockId> --markdown "<chunk_content>"
```

#### Step 4: 结果自检与深度链接返回
1. 调用 `craft_read` 校验文档末尾内容，确认全部章节已追加。
2. 校验图片块是否全部包含 `uploaded: true`。
3. 向用户返回文档标题及 `craftdocs://open?spaceId=...&documentId=...` 客户端快速打开链接。

---

## 参数选项一览

| 参数 | 简写 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `--output <dir>` | `-o` | `./wechat-articles` | 指定文章存放的主目录 |
| `--file <path>` | `-f` | - | 指定包含链接的文本文件（自动提取有效 URL） |
| `--stdin` | `-s` | `false` | 从标准输入管道读取任意文本并自动抓取所有公众号 URL |
| `--format <type>` | - | `standard` | 图片语法格式：`standard` (`![](images/...)`) 或 `obsidian` (`![[...]]`) |
| `--help` | `-h` | - | 显示帮助信息 |

---

## 异常与反爬兜底

- **请求机制**：默认模拟微信 iOS 移动客户端专属 UA，直连服务端渲染通道，单篇耗时仅需 2~5 秒。
- **人机滑块验证兜底**：若某 IP 频繁高并发请求触发了微信的滑块验证码页面（含 `secitptpage/verify`），脚本会明确提示。此时 Agent 可使用 `ego-browser` 唤起一个带界面的窗口供人工滑动一次，之后即可长效恢复纯脚本秒级运行。

