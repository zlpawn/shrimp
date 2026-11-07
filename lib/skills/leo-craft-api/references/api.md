# Craft Full Space API Reference Manual

本文档整理自官方导出的 Craft Full Space API 规范（`instructions_to_agent.md`），为 Agent 与开发者提供完整、精确的 API 端点、请求模型与参数定义。

---

## 1. 基础配置与鉴权机制

- **API Base URL 格式**：`https://connect.craft.do/links/{linkId}/api/v1`
  - `linkId` 每个 Craft 连接独有，没有默认值，须写入下方的持久化配置。
- **鉴权方式**：`Authorization: Bearer <API_KEY>`
- **持久化配置路径**：`~/.shrimp/skills/leo-craft-api/config.json`（独立配置文件，禁止提交代码仓库）
- **完全独立无网关依赖**：纯 Node.js 标准库实现，不依赖 Gateway 服务或守护进程，支持独立运行。
- **相对路径与便携性**：所有文件读写均支持相对于当前工作目录的相对路径，无任何写死绝对路径。

### 速率限制 (Rate Limits)
| 作用域 | 限制规则 | 触发响应 |
|---|---|---|
| 公网来源 IP (Public IP) | 50 requests / 10 秒 | HTTP 429 |
| Craft Space (空间全局) | 100 requests / 60 秒 | HTTP 429 |
| 块级读写 (Block Read/Write) | 20,000 blocks / 60 秒 | HTTP 429 |

- **限流响应头**：
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - `X-BlockBudget-*`（块级消耗配额）
  - `Retry-After`：包含重试等待秒数。客户端应采用指数避退 + Jitter 机制重试。

---

## 2. Craft 专属 Markdown 扩展语法

Craft 接口在读写块（Blocks）时，使用标准 Markdown 并扩展了以下专属 XML/HTML 格式标签：

### 页面与卡片结构
| 标签 | 说明 |
|---|---|
| `<page>...<\/page>` | 嵌套子页面（Sub-document）。可选属性：`textStyle="card"`、`cardLayout`、`id` |
| `<card>...<\/card>` | 等同于 `<page textStyle="card">` |
| `<pageTitle>...<\/pageTitle>` | 子页面标题（必须为 `<page>` 的第一个子元素） |
| `<content>...<\/content>` | 子页面主体内容（紧跟在 `<pageTitle>` 之后） |

### 块级样式
| 标签 | 说明 |
|---|---|
| `<callout>...<\/callout>` | 高亮强调框（Callout / 标注框） |
| `<caption>...<\/caption>` | 小号弱化说明文字（Caption） |

### 行内样式与公式
| 语法 / 标签 | 说明 |
|---|---|
| `<highlight color="...">...<\/highlight>` | 背景高亮。支持预设色（`yellow`, `green`, `mint`, `cyan`, `blue`, `purple`, `pink`, `red`, `gray`, `gradient-*`）或 Hex（`#123456`，双模态 `colorDark="#abcdef"`） |
| `==text==` | 等同于 `<highlight color="yellow">text<\/highlight>` |
| `$formula$` 或 `$$formula$$` | LaTeX 数学公式（行内或独立块） |
| `<comment id="...">...<\/comment>` | 附带评论线的文本，`id` 指向评论线程 |

### 双链与缩进
| 语法 | 说明 |
|---|---|
| `[text](block://<blockId>)` | 引用空间内其他块的双链 |
| `[text](date://YYYY-MM-DD)` | 关联特定日期的 Daily Note 日记双链 |
| 每 2 个前导空格 | 表示一级缩进（层级嵌套） |

---

## 3. 核心 API 端点一览

### 1) 空间连接信息 (Connection)
- **`GET /connection`**
  - 返回值：空间元数据（`space.id`, `space.name`, `space.timezone`, `space.time`, `space.friendlyDate`, `urlTemplates.app` 等）

### 2) 目录结构 (Folders)
- **`GET /folders`**
  - 获取空间所有内置虚拟位置（`unsorted`, `trash`, `templates`）以及所有用户文件夹的层级树和文档计数（`documentCount`）。
- **`POST /folders`**
  - 创建文件夹。Body: `{ folders: [{ name: "string", parentFolderId?: "string" }] }`
- **`DELETE /folders`**
  - 删除文件夹。子文档和子目录会自动移动至父文件夹或 Unsorted。Body: `{ folderIds: ["string"] }`
- **`PUT /folders/move`**
  - 移动文件夹位置。Body: `{ folderIds: ["string"], destination: "root" | { parentFolderId: "string" } }`

### 3) 文档管理 (Documents)
- **`GET /documents`**
  - 查询参数：
    - `location`: `'unsorted' | 'trash' | 'templates' | 'daily_notes'`
    - `folderId`: 目标文件夹 ID（递归包含子目录）
    - `fetchMetadata`: `true | false`（是否返回 `createdAt`, `lastModifiedAt`, `clickableLink`）
    - `createdDateGte`, `createdDateLte`, `lastModifiedDateGte`, `lastModifiedDateLte`, `dailyNoteDateGte`, `dailyNoteDateLte`
- **`POST /documents`**
  - 创建文档。Body:
    ```json
    {
      "documents": [{ "title": "文档标题", "content"?: [...] }],
      "destination": { "folderId": "string" } // 或 { "destination": "unsorted" | "templates" }
    }
    ```
- **`DELETE /documents`**
  - 软删除文档（移至回收站 trash）。Body: `{ documentIds: ["string"] }`
- **`PUT /documents/move`**
  - 移动文档或从回收站恢复。Body:
    ```json
    {
      "documentIds": ["string"],
      "destination": { "folderId": "string" } // 或 { "destination": "unsorted" }
    }
    ```
- **`GET /documents/search`**
  - 全空间文档检索（BM25 / 相关度排序，Top 20）。
  - 参数：`include`（关键词）、`regexps`（RE2 正则）、`location`、`folderIds`、`fetchBlocks`（是否附带命中块详情）

### 4) 块与正文操作 (Blocks)
- **`GET /blocks`**
  - 读取指定块或 Daily Note 的完整正文。
  - 参数：
    - `id`: 文档根块 ID 或任意块 ID（与 `date` 互斥）
    - `date`: `'today' | 'yesterday' | 'tomorrow' | 'YYYY-MM-DD'`（读取 Daily Note）
    - `maxDepth`: 层级深度（`-1` 为所有子块，`0` 仅当前块，`1` 仅直接子块）
    - `fetchMetadata`: 是否包含创建/修改人与时间
  - Headers:
    - `Accept: application/json` 返回结构化 JSON AST
    - `Accept: text/markdown` 直接返回完整 Markdown 原文
- **`POST /blocks`**
  - 追加/插入内容（支持 Markdown 字符串或 Blocks JSON 树）。Body:
    ```json
    {
      "markdown": "## 章节标题\n\n正文内容...",
      "position": {
        "position": "start" | "end" | "before" | "after",
        "pageId": "文档根ID",
        "targetBlockId": "目标块ID (before/after使用)",
        "date": "today" // 当针对日记时
      }
    }
    ```
- **`PUT /blocks`**
  - 修改已有块内容。Body: `{ blocks: [{ id: "string", markdown: "string", font?: "string" }] }`
- **`DELETE /blocks`**
  - 删除块。Body: `{ blockIds: ["string"] }`
- **`PUT /blocks/move`**
  - 调整块在文档内的顺序或跨文档转移。Body:
    ```json
    {
      "blockIds": ["string"],
      "position": {
        "position": "start" | "end" | "before" | "after",
        "pageId": "string",
        "targetBlockId"?: "string"
      }
    }
    ```
- **`GET /blocks/search`**
  - 在单个文档内部搜索块。参数：`id`（文档ID）、`query`（检索词）

### 5) 任务清单 (Tasks)
- **`GET /tasks`**
  - 参数：`scope`（`'active' | 'upcoming' | 'inbox' | 'logbook' | 'document' | 'all'`）、`documentId`（scope 为 document 时必填）
- **`POST /tasks`**
  - 创建任务。Body: `{ tasks: [{ markdown: "string", date?: "YYYY-MM-DD", time?: "HH:mm" }] }`
- **`PUT /tasks`**
  - 更新任务状态。Body: `{ tasks: [{ id: "string", taskInfo: { state: "todo" | "done" | "cancelled" }, markdown?: "string" }] }`
- **`DELETE /tasks`**
  - 删除任务。Body: `{ taskIds: ["string"] }`

### 6) 集合数据表 (Collections)
- **`GET /collections`**：列出空间或指定文档内的集合
- **`POST /collections`**：创建集合
- **`GET /collections/{id}/items`**：获取集合数据行
- **`POST /collections/{id}/items`**：新增数据行
- **`PUT /collections/{id}/items`**：修改数据行
- **`DELETE /collections/{id}/items`**：删除数据行
- **`GET /collections/{id}/schema`**：获取字段定义
- **`PUT /collections/{id}/schema`**：更新字段定义
- **`GET /collections/{id}/views`**：获取视图列表

### 7) 文件上传与附件 (Files)
- **`POST /upload`**
  - 上传本地图片、视频或文件并插入指定文档位置。
  - 参数（Query）：
    - `position`: `'start' | 'end' | 'before' | 'after'`
    - `pageId`: 目标文档/页面 ID
    - `date`: 日记日期（当向日记插入时）
    - `siblingId`: 兄弟块 ID（before/after 时必填）
    - `fileName`: 附件展示文件名
  - Body: 二进制二进制流，设置匹配的 `Content-Type`（`image/png`, `application/pdf` 等）
  - 返回值：`{ blockId: "string", assetUrl: "string" }`

### 8) 双链与提醒 (Internal Links & Reminders)
- **`GET /internal-links`**：获取文档间正向引用与反向双链（Backlinks）统计
- **`GET /reminders`**：获取提醒列表（`incomplete`, `completed`, `upcoming`, `all`）
- **`POST /reminders`**、**`PUT /reminders`**、**`DELETE /reminders`**：提醒事项操作

---

## 4. Agent 执行安全守则 (Production Safety)

- **生产环境原则**：Craft API 直接直连用户的真实生产笔记本与知识库。
- **只读操作优先**：`GET` 请求完全安全；在修改或删除内容前，先确认操作目标。
- **软删除与可逆原则**：
  - 删除文档（`DELETE /documents`）会保留在回收站（trash）中，可用 `PUT /documents/move` 恢复。
  - 块级删除（`DELETE /blocks`）不可从回收站恢复，修改或删除大篇幅块之前，必须先 `GET /blocks` 备份原数据。
