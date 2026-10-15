---
name: leo-wechat-to-html
description: "微信公众号文章像素级离线 HTML 原版还原与结构化 Markdown 本地化抓取器。突破腾讯防盗链与反爬验证，全量并发下载高清原图与原生内联 CSS，生成 100% 离线脱网可读的 HTML 原文与清洗后的结构化 Markdown（含 Frontmatter、表格重构与代码块）。支持单个/多个 URL 传参、链接清单文件、标准输入管道（Stdin）及与 Craft 笔记深度联动批量下载。Use when user asks to '下载公众号文章', '抓取微信文章', '微信文章转HTML', '保存公众号文章', '下载微信排版', provides WeChat URLs (mp.weixin.qq.com), or wants to extract WeChat links from Craft notes."
metadata:
  version: "1.1.0"
  author: "Leo"
---

# Leo WeChat to HTML & Markdown (微信公众号文章高保真本地化引擎)

专为微信公众号深度打造的本地化归档与知识沉淀 Skill。一键突破微信移动端反爬防护与 `mmbiz.qpic.cn` 图片防盗链，秒级直取服务端原生内容，提供 **「像素级脱网 HTML」** 与 **「结构化 Markdown」** 双重交付。

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

---

## 常用 CLI 命令

脚本位于：`/Users/pa/.agents/skills/leo-wechat-to-html/scripts/wechat-dl.mjs`

### 1. 抓取单个或多个微信文章链接
```bash
node /Users/pa/.agents/skills/leo-wechat-to-html/scripts/wechat-dl.mjs "<url1>" ["<url2>"] -o ./wechat-articles
```

### 2. 从链接清单文本文件中批量抓取
```bash
node /Users/pa/.agents/skills/leo-wechat-to-html/scripts/wechat-dl.mjs -f links.txt -o ./wechat-articles
```

### 3. 从终端管道或标准输入（Stdin）抓取
```bash
cat article_urls.txt | node /Users/pa/.agents/skills/leo-wechat-to-html/scripts/wechat-dl.mjs -s -o ./wechat-articles
```

### 4. 与 Craft 笔记深度联动（一阶段 -> 二阶段桥梁）
当用户指示“抓取某篇 Craft 笔记中的所有微信文章”时：
1. Agent 调用 `craft_read` MCP 工具读取目标 Craft 笔记正文；
2. 提取文本中出现的 `https://mp.weixin.qq.com/s/...` 链接；
3. 直接调用 CLI 脚本批量保存至本地：
```bash
node /Users/pa/.agents/skills/leo-wechat-to-html/scripts/wechat-dl.mjs "<extracted_url1>" "<extracted_url2>" -o ./wechat-articles
```

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
