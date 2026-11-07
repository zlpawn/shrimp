---
name: leo-craft-api
description: "Use when the user wants to read, search, create, update, or organize documents, folders, daily notes, blocks, tasks, collections, or media files in Craft note-taking app via the official Craft Full Space API, or when configuring Craft API connection tokens."
---

# Leo Craft API (`leo-craft-api`)

本 Skill 专为通过 **Craft Full Space API** 编程化操作 Craft 笔记空间而打造，支持空间全量目录发现、文档读写、块级内容注入与微调、任务清单追踪、结构化数据集合（Collections）以及本地图片/文件直传图床。

详细端点参考文档：[references/api.md](references/api.md)

---

## 1. 鉴权与配置规范 (Credentials & Security)

为了防止凭证泄露，API 地址和 API Key 遵循本地配置隔离规范，**严禁提交至 Git 代码仓库**，且**不依赖环境变量**：

- **配置文件路径**：`~/.shrimp/skills/leo-craft-api/config.json`
- **API 地址**：每个 Craft 连接独有，格式为 `https://connect.craft.do/links/<linkId>/api/v1`，没有默认值
- **零网关依赖 & 纯独立运行**：仅依赖 Node.js 内置模块（无需网关后端服务运行，无需 `npm install` 外部依赖）。
- **全相对路径支持**：文档追加（`--file`）和媒体上传（`upload`）全面支持相对路径（如 `./notes.md`、`./images/pic.png`）。

### 首次使用检查与配置 (Agent SOP)

在执行任何写操作或查询前，Agent 可先验证配置：

```bash
# 查看当前配置（API Key 自动脱敏）
node <skillDir>/scripts/craft-api.mjs config get

# 保存/更新 API URL 和 API Key（保存到 ~/.shrimp/skills/leo-craft-api/config.json）
node <skillDir>/scripts/craft-api.mjs config set --api-url "<YOUR_CRAFT_API_URL>" --api-key "<YOUR_CRAFT_BEARER_TOKEN>"
```

> **如果调用接口提示 `Craft API URL is not set!` 或 `Craft API Key is not set!`**：
> 主动提示用户：“当前尚未配置 Craft API 连接，请在终端执行 `node <skillDir>/scripts/craft-api.mjs config set --api-url <url> --api-key <token>`，地址和密钥将保存在 `~/.shrimp/skills/leo-craft-api/config.json` 中。”

---

## 2. 常用操作速查清单 (CLI Commands)

入口脚本位于：`<skillDir>/scripts/craft-api.mjs`

### 1) 空间连接与目录发现 (Discovery)
```bash
# 1. 验证连接并查看空间基础信息 (Space ID, 名称, 时区, App唤起链接)
node <skillDir>/scripts/craft-api.mjs info

# 2. 列出所有文件夹与系统位置（Unsorted、Trash、Templates 及各目录文档数）
node <skillDir>/scripts/craft-api.mjs folders list

# 3. 创建新文件夹（支持根目录或嵌套）
node <skillDir>/scripts/craft-api.mjs folders create "技术归档"
node <skillDir>/scripts/craft-api.mjs folders create "2026架构" --parent "<folderId>"
```

### 2) 文档检索与列表 (Documents)
```bash
# 列出未分类文档 (带元数据与客户端可打开的 deep link)
node <skillDir>/scripts/craft-api.mjs docs list --location unsorted --metadata

# 列出指定文件夹下的文档
node <skillDir>/scripts/craft-api.mjs docs list --folder "<folderId>"

# 全局相关度全文搜索（跨所有文档搜索关键字）
node <skillDir>/scripts/craft-api.mjs docs search "架构演进"

# 跨文档正则检索并提取命中块
node <skillDir>/scripts/craft-api.mjs docs search --regex "2026-[0-9]{2}" --fetch-blocks
```

### 3) 文档创建、移动与删除
```bash
# 在指定文件夹创建新文档（返回 documentId 与 clickableLink）
node <skillDir>/scripts/craft-api.mjs docs create "大模型落地实战总结" --folder "<folderId>"

# 软删除文档（安全移入回收站 trash）
node <skillDir>/scripts/craft-api.mjs docs delete "<documentId>"

# 从回收站恢复文档到 Unsorted，或在文件夹间移动
node <skillDir>/scripts/craft-api.mjs docs move "<documentId>" --to-unsorted
node <skillDir>/scripts/craft-api.mjs docs move "<documentId>" --to "<newFolderId>"
```

### 4) 正文与块级读写 (Blocks & Content)
```bash
# 读取文档完整 Markdown 正文（推荐 Agent 摄取上下文使用）
node <skillDir>/scripts/craft-api.mjs blocks get "<documentId>" --format markdown

# 读取结构化 JSON 块树（包含样式、block ID 与嵌套 page）
node <skillDir>/scripts/craft-api.mjs blocks get "<documentId>" --format json --depth 2

# 读取今日日记 (Daily Note)
node <skillDir>/scripts/craft-api.mjs blocks get --date today --format markdown

# 向文档尾部追加 Markdown 内容（支持行内高亮、公式、callout 等）
node <skillDir>/scripts/craft-api.mjs blocks insert --page "<documentId>" --markdown "## 第一章：背景\n\n项目核心背景..."

# 从本地文件批量导入内容到文档
node <skillDir>/scripts/craft-api.mjs blocks insert --page "<documentId>" --file "./chapter.md"

# 修改单个 Block 的内容
node <skillDir>/scripts/craft-api.mjs blocks update "<blockId>" --markdown "更新后的内容"

# 删除特定块
node <skillDir>/scripts/craft-api.mjs blocks delete "<blockId1>" "<blockId2>"
```

### 5) 任务管理 (Tasks)
```bash
# 获取当前待办任务 (active)
node <skillDir>/scripts/craft-api.mjs tasks list --scope active

# 获取任务收件箱 (inbox) 或 全部任务 (all)
node <skillDir>/scripts/craft-api.mjs tasks list --scope inbox

# 新增任务（带截止日期）
node <skillDir>/scripts/craft-api.mjs tasks add "完成后端接口对齐" --date "today"

# 更新任务状态为已完成
node <skillDir>/scripts/craft-api.mjs tasks update "<taskId>" --state done
```

### 6) 本地文件/图片直传 (Upload Media)
```bash
# 上传本地图片或 PDF 附件并插入文档末尾（Craft 自动转存官方 CDN，支持相对路径）
node <skillDir>/scripts/craft-api.mjs upload "./assets/diagram.png" --page "<documentId>"
```

### 7) 集合与数据表 (Collections)
```bash
# 查看文档中的集合数据表
node <skillDir>/scripts/craft-api.mjs collections list --doc "<documentId>"

# 读取集合数据行
node <skillDir>/scripts/craft-api.mjs collections items "<collectionId>"
```

### 8) 底层通用请求兜底 (Raw API)
对于任何高级或试验性端点，可直接发起 Raw API 调用：
```bash
node <skillDir>/scripts/craft-api.mjs raw GET /internal-links
node <skillDir>/scripts/craft-api.mjs raw POST /comments --body '{"comments":[{"blockId":"<id>","markdown":"评论内容"}]}'
```

---

## 3. 核心避坑与操作规范 (Best Practices)

1. **Craft 专属标签兼容性**：
   - 嵌套卡片/子页面：使用 `<card>卡片标题<content>卡片内部正文</content></card>` 或 `<page>`。
   - 标注强调框：使用 `<callout>重要提示信息</callout>`。
   - 文本高亮：使用 `<highlight color="yellow">重点词</highlight>` 或 `==重点词==`。
   - 数学公式：`$E = mc^2$` 或 `$$\sum_{i=1}^n x_i$$`。
2. **长文分块注入防超时 (Chunking)**：
   - 当向 Craft 写入超长文档时，避免单次发送超大 Payload。建议每 20~40 个块或按 `##` 二级标题切分为单个分块，依次追加到文档末尾。
3. **真实用户生产数据安全准则**：
   - Craft API 直接作用于用户的真实知识库。
   - `DELETE /documents` 会放入垃圾箱，属于可逆操作；但 `DELETE /blocks` 是直接物理移除，删除前应先通过 `blocks get` 读取备份。
   - 尽量优先使用只读查询确认目标后再执行写操作。
