# Dream Skin 主题系统设计

**日期：** 2026-08-11
**状态：** 待评审
**分支：** `codex/dream-skin`
**实现路线：** 方案 A，领域模块优先，Web 面板随后接入

> **2026-08-13 扩展说明：** `codex/dream-skin-extensions` 已将“应用到 Codex”
> 确认为核心功能。下文“不启动、不连接、不注入”的限制仅描述原第一阶段范围；
> 当前扩展阶段允许用户显式触发 Codex 启动或重启、CDP 连接和运行时主题注入。
> 运行时能力必须保持平台受限、用户确认重启、目标身份校验、配置隔离和错误可恢复。

---

## 1. 背景

Shrimp 当前是一个本地 AI 网关项目，已经有模块化的 Node.js 服务端、TypeScript Web 管理面板和独立 CLI。参考项目 CodexPlusPlus 提供了一套较完整的 Codex Desktop 主题系统，包括：

- 多套渲染引擎资源；
- 本地主题库；
- 在线主题市场；
- 主题安装、删除和更新；
- 主题编辑与预览；
- 社区主题包；
- Safe CSS；
- Codex Desktop 启动、CDP 连接和运行时注入。

Shrimp 现有 `codex/dream-skin` 分支已经包含一个实验性原型：

- macOS Codex Desktop 启动器；
- CDP WebSocket 客户端；
- JavaScript 注入脚本构建；
- 四套上游 renderer/CSS 引擎资源；
- 基础主题 JSON；
- 部分路径和静态测试。

这套原型尚未接入网关 API 和 Web 面板，也不具备完整的主题库与市场能力。直接继续在现有原型上堆功能容易混淆主题管理和 Codex 注入，因此本设计先明确模块边界、第一阶段范围和安全约束。

---

## 2. 核心决策

### 2.1 第一阶段目标

第一阶段模仿 CodexPlusPlus 的主题管理体验和市场格式，完成：

1. 引擎资产集成；
2. 主题市场拉取、缓存和 SHA-256 校验；
3. 主题安装、更新和删除；
4. 本地主题库管理；
5. Web 面板主题列表、市场浏览、预览和颜色编辑器；
6. CDP 运行时代码整理和静态适配。

### 2.2 第一阶段明确不做

- 不启动 Codex Desktop；
- 不连接 CDP；
- 不执行注入；
- 不暴露启动、应用、注入或清理 Codex 的 HTTP API；
- 不提供用户上传和社区审核服务；
- 不支持社区 ZIP 主题包；
- 不支持 `theme.css`；
- 不实现 Safe CSS 解析或编译；
- 不允许主题携带 JavaScript；
- 不允许主题配置引用远程图片、字体、CSS 或其他远程资源；
- 不修改 Codex Desktop 的 `app.asar`、安装目录、用户配置或其他文件。

### 2.3 “切换主题”的定义

第一阶段中的“切换主题”只表示：

- 将某个主题设为 Shrimp Dream Skin 当前选中主题；
- Web 面板和预览区使用该主题；
- 将选择状态持久化，为未来显式授权的 Codex 注入提供输入。

它不表示：

- 自动应用到 Codex；
- 自动启动或重启 Codex；
- 自动连接调试端口；
- 修改 Codex 当前界面。

UI 文案使用“设为当前主题”或“选择主题”，避免使用容易误解为已经注入的“应用到 Codex”。

### 2.4 兼容而非复制

- 四套 MIT 许可证的 renderer/CSS 资源可以保留原始 LICENSE 和署名后使用。
- Shrimp 的主题库、市场、文件操作、HTTP API 和 UI 使用 Node.js/TypeScript 独立实现。
- 不直接翻译或复制 CodexPlusPlus 的 AGPL Rust 业务代码。
- 数据格式和外部行为尽量兼容 CodexPlusPlus，内部模块组织遵循 Shrimp 现有代码结构。

---

## 3. 第一阶段功能范围

| 模块 | 第一阶段范围 | 延后内容 |
| --- | --- | --- |
| 引擎资产集成 | 四套内置引擎、资源加载、占位符替换、签名计算、静态语法校验 | 动态安装第三方引擎 |
| 主题市场 | 拉取 `index.json`、校验、缓存、离线降级、安装状态和更新状态 | 用户上传、审核、评分、评论 |
| 主题安装 | 下载 `theme.json` 和图片、SHA-256、内容校验、原子安装、更新 | ZIP 包、签名验证、Safe CSS |
| 本地主题库 | 列表、详情、创建、编辑、复制、导入、删除、选择 | 多用户同步、云端同步 |
| Web 面板 | 本地主题、市场、编辑器、模拟工作台预览 | 真实 Codex DOM 预览 |
| CDP 适配 | 资源构建和协议代码静态验证 | 启动、连接、注入、运行时验收 |

---

## 4. 架构

### 4.1 总体结构

```text
desktop/src/modules/dream-skin.ts
            |
            v
lib/dream-skin/http/routes.mjs
            |
            v
lib/dream-skin/application/service.mjs
       /              \
      v                v
library/              market/
       \              /
        v            v
       domain/ + paths.mjs

runtime/  独立存在，不被上述正常调用链导入
```

### 4.2 建议目录

```text
lib/dream-skin/
├── domain/
│   ├── theme-schema.mjs
│   ├── theme-id.mjs
│   ├── image-format.mjs
│   └── errors.mjs
├── library/
│   ├── store.mjs
│   ├── importer.mjs
│   ├── active-theme.mjs
│   └── mutation-queue.mjs
├── market/
│   ├── client.mjs
│   ├── schema.mjs
│   ├── cache.mjs
│   ├── installer.mjs
│   └── install-records.mjs
├── preview/
│   └── model.mjs
├── application/
│   └── service.mjs
├── http/
│   └── routes.mjs
├── runtime/
│   ├── engine-assets.mjs
│   ├── injector.mjs
│   ├── cdp-client.mjs
│   └── launcher.mjs
├── extensions/
│   ├── package-provider.mjs
│   ├── css-compiler.mjs
│   └── community-provider.mjs
├── engines/
├── THIRD_PARTY_NOTICES.md
└── paths.mjs
```

### 4.3 模块职责

#### `domain`

纯领域层，不依赖文件系统、HTTP、CDP 或 Web UI。

负责：

- 主题配置标准化；
- 字段和枚举校验；
- 主题 ID 校验；
- 图片类型识别；
- 统一错误码。

#### `library`

本地主题持久化层。

负责：

- 读取主题目录；
- 主题 CRUD；
- 当前主题状态；
- 原子写入；
- 并发变更串行化；
- 拒绝符号链接和非法目录。

不知道主题来自市场、导入还是编辑器。

#### `market`

远程市场客户端和安装器。

负责：

- 拉取并校验市场索引；
- 写入和读取缓存；
- 下载主题配置和图片；
- SHA-256 校验；
- 安装版本记录；
- 判断是否已安装和是否存在更新。

市场安装最终调用 `library`，不维护第二套主题库。

#### `preview`

将主题配置转成 Web 面板可消费的受控预览模型。

不输出任意 HTML、CSS 或脚本，只输出：

- 主题颜色变量；
- 背景图 URL；
- 明暗模式；
- 文案；
- 布局参数；
- 引擎名称。

#### `application`

应用服务层，编排领域操作。

HTTP 路由只调用这一层，避免路由直接操作文件。

#### `http`

负责：

- 路由匹配；
- 请求体大小限制；
- 参数解析；
- 错误码到 HTTP 状态映射；
- JSON 或图片响应。

不包含主题业务逻辑。

#### `runtime`

Codex Desktop 相关实验运行时。

第一阶段只允许：

- 加载引擎资源；
- 构建最终注入脚本；
- 构建清理脚本；
- 验证占位符全部替换；
- 验证脚本语法；
- 测试 CDP 消息编码和目标过滤逻辑。

第一阶段不允许从 HTTP、Web UI、网关启动流程或正常 CLI 入口调用启动器和注入器。

#### `extensions`

为延后功能定义边界：

- `package-provider`：未来 ZIP 主题包解析和签名验证；
- `css-compiler`：未来 Safe CSS 校验和编译；
- `community-provider`：未来上传、审核和社区服务。

第一阶段只在应用服务的依赖注入接口和能力模型中预留这些 provider，不创建空实现文件，也不在 UI 展示不可用入口。应用服务暴露能力标志：

```json
{
  "packageImport": false,
  "customCss": false,
  "communityPublishing": false,
  "codexRuntime": false
}
```

---

## 5. 数据目录

### 5.1 路径规则

所有 Dream Skin 数据跟随现有 `resolveProjectPath` 和 `GATEWAY_CONFIG_FILE` 语义。

```text
configPath = resolveProjectPath(
  process.env.GATEWAY_CONFIG_FILE || "gateway.config.json"
)
configDir = dirname(configPath)
dreamSkinDir = join(configDir, "dream-skin")
```

结果：

- 源码运行且未配置其他路径时，数据位于项目目录；
- npm CLI 将配置放在 `~/.shrimp` 时，数据位于 `~/.shrimp/dream-skin`；
- 自定义绝对 `GATEWAY_CONFIG_FILE` 时，数据跟随该文件；
- Dream Skin 不单独判断“源码安装”或“npm 安装”。

### 5.2 文件布局

```text
<configDir>/dream-skin/
├── state.json
├── themes/
│   ├── <theme-id>/
│   │   ├── theme.json
│   │   └── background.<ext>
│   └── ...
├── market/
│   ├── index.json
│   ├── installed.json
│   └── previews/
└── .staging/
```

### 5.3 `state.json`

```json
{
  "schemaVersion": 1,
  "selectedThemeId": "shrimp-default",
  "selectedAt": "2026-08-11T00:00:00.000Z"
}
```

状态文件只保存当前选择，不复制完整主题配置。

内置主题使用稳定 ID `shrimp-default`。`builtin` 只作为主题类型值，不作为主题 ID。`shrimp-default` 和 `builtin` 都是保留 ID，本地创建、导入和市场安装不能使用。

### 5.4 `installed.json`

```json
{
  "schemaVersion": 1,
  "themes": {
    "theme-id": {
      "version": "1.2.0",
      "source": "market",
      "installedAt": "2026-08-11T00:00:00.000Z",
      "updatedAt": "2026-08-11T00:00:00.000Z"
    }
  }
}
```

本地创建或手动导入的主题不要求市场版本记录。

---

## 6. 主题数据模型

### 6.1 标准主题配置

第一阶段兼容 CodexPlusPlus 市场主题的主要字段：

```json
{
  "schemaVersion": 1,
  "id": "aurora-night",
  "name": "Aurora Night",
  "stylePreset": "midnight-aurora",
  "brandSubtitle": "CODEX DREAM SKIN",
  "tagline": "Make something wonderful.",
  "projectPrefix": "选择项目 · ",
  "projectLabel": "选择项目",
  "statusText": "THEME READY",
  "quote": "FOCUS",
  "image": "background.webp",
  "appearance": "auto",
  "art": {
    "focusX": 0.5,
    "focusY": 0.5,
    "safeArea": "auto",
    "taskMode": "ambient"
  },
  "colors": {
    "background": "#111318",
    "panel": "#181b22",
    "panelAlt": "#20242d",
    "accent": "#8298a3",
    "accentAlt": "#a8c0ca",
    "secondary": "#6f8791",
    "highlight": "#bfd4dc",
    "text": "#edf2f4",
    "muted": "#a4afb5",
    "line": "rgba(130, 152, 163, 0.28)"
  }
}
```

### 6.2 字段规则

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 第一阶段只接受 `1` |
| `id` | 1-64 字节，小写字母或数字开头，仅允许小写字母、数字、`-`、`_`、`.` |
| `name` | 1-100 个字符 |
| `stylePreset` | 只接受内置引擎映射支持的值或空字符串 |
| `image` | 只允许当前主题目录中的单个文件名，不允许路径分隔符和 URL |
| `appearance` | `auto`、`light` 或 `dark` |
| `focusX/focusY` | `0` 到 `1` |
| `safeArea` | `auto`、`left`、`right`、`center`、`none` |
| `taskMode` | `ambient`、`banner`、`off` |
| `colors` | 只接受定义的颜色键，不接受额外键 |
| 文案字段 | 有明确长度上限，不解释为 HTML |

### 6.3 兼容字段

读取时兼容早期 Shrimp 原型：

- `backgroundImage` 标准化为 `image`；
- `style_preset` 标准化为 `stylePreset`。

写回磁盘时统一使用标准 camelCase 字段。

### 6.4 颜色规则

颜色值第一阶段接受：

- `#RGB`；
- `#RRGGBB`；
- `#RRGGBBAA`；
- `rgb(...)`；
- `rgba(...)`。

不接受：

- `url(...)`；
- `var(...)`；
- `expression(...)`；
- CSS 转义；
- 分号；
- 换行；
- 自定义 CSS 片段。

颜色编辑器仅生成规范化的十六进制或 `rgba(...)` 值。

### 6.5 引擎映射

| `stylePreset` | 引擎 |
| --- | --- |
| `codex-snow` | `snow` |
| `glass-vision` | `glass-vision` |
| `midnight-aurora`、`amber-dusk`、`forest-mist`、`cyber-neon`、`sakura-dawn` | `cidala-tiger` |
| 空值或其他受支持的基础预设 | `dream-skin` |

未知 `stylePreset` 在导入和市场安装时拒绝，不静默回退。内置默认主题可使用空值。

---

## 7. 图片处理

### 7.1 支持格式

- PNG；
- JPEG；
- WebP；
- GIF；
- BMP。

### 7.2 校验

不能只信任扩展名或 MIME 类型。导入和下载后必须通过文件头识别真实格式，并确认：

- 文件非空；
- 大小不超过 16 MiB；
- 扩展名与真实格式一致；
- 不是 SVG；
- 不是 HTML、脚本或其他伪装文件。

### 7.3 存储

主题目录必须且只能有：

- 一个 `theme.json`；
- 一个受支持的背景图片。

第一阶段不把预览图单独存入本地主题目录，主题背景图即本地预览来源。

---

## 8. 本地主题库

### 8.1 主题类型

- `builtin`：Shrimp 内置默认主题，只读；
- `stored`：本地保存、市场安装或手动导入的主题；
- `draft`：Web 编辑器中尚未保存的内存状态，不写入主题库。

### 8.2 功能

本地主题库支持：

- 列表；
- 详情；
- 创建；
- 复制；
- 编辑；
- 导入 `theme.json + 图片`；
- 删除；
- 设为当前主题；
- 判断市场来源和版本；
- 生成预览模型。

### 8.3 创建

用户可以：

- 从内置主题创建副本；
- 从已安装主题创建副本；
- 从图片创建主题；
- 从空白模板创建主题。

新主题 ID 由名称生成 slug，冲突时追加 `-2`、`-3`。

### 8.4 编辑

可编辑：

- 名称；
- 引擎预设；
- 明暗模式；
- 背景图片；
- 图片焦点；
- 安全区域；
- 任务页背景模式；
- 主题颜色；
- 展示文案。

不可编辑：

- 市场安装记录；
- 文件系统路径；
- 引擎 renderer/CSS；
- 任意 CSS；
- 任意 JavaScript。

编辑市场安装的主题时，不直接覆盖市场版本。首次保存编辑结果时自动执行“另存为本地副本”，避免后续市场更新覆盖用户修改。

### 8.5 删除

- 内置主题不能删除；
- 当前选中主题不能直接删除；
- 用户需要先选择其他主题；
- 删除仅接受主题 ID，不接受路径；
- 删除前通过 `lstat` 拒绝符号链接；
- 删除后同步清理对应市场安装记录；
- 删除失败不修改 `state.json`。

### 8.6 选择主题

选择流程：

1. 验证主题存在且完整；
2. 读取并重新校验 `theme.json`；
3. 验证背景图；
4. 原子写入 `state.json`；
5. 返回新的主题库状态。

不触发任何 runtime 行为。

### 8.7 原子写入

创建、导入、市场安装和更新统一采用：

1. 在 `.staging/<operation-id>` 写入；
2. 校验 staging 中最终内容；
3. `fsync` 必要文件；
4. 同文件系统 rename；
5. 更新安装记录；
6. 清理 staging。

更新已有主题时：

1. staging 写入新版本；
2. 原目录临时改名为 backup；
3. staging 改名为正式目录；
4. 更新记录；
5. 删除 backup；
6. 任一步失败则回滚。

所有写操作通过进程内 mutation queue 串行执行，避免同时安装、编辑或删除同一主题。

---

## 9. 本地导入

### 9.1 第一阶段导入格式

只支持：

- 一个主题 JSON；
- 一个背景图片。

不支持：

- ZIP；
- `manifest.json`；
- `manifest.sig`；
- `theme.css`；
- `LICENSE.txt` 打包导入；
- JavaScript；
- 多图片；
- 远程 URL。

### 9.2 Web 上传协议

Web 面板通过 JSON 请求上传：

```json
{
  "theme": {
    "schemaVersion": 1,
    "id": "my-theme",
    "name": "My Theme",
    "image": "background.png"
  },
  "image": {
    "name": "background.png",
    "dataBase64": "..."
  }
}
```

HTTP 层设置独立请求体上限。按 16 MiB 图片和 Base64 开销计算，请求上限设为 24 MiB。

应用服务接收解码后的字节，不依赖 HTTP/Base64 表示。

### 9.3 冲突处理

导入 ID 已存在时默认返回 `theme_already_exists`，不自动覆盖。

UI 提供：

- 取消；
- 另存为新 ID；
- 明确选择“替换本地主题”。

市场主题不能通过导入操作静默替换。

---

## 10. 主题市场

### 10.1 默认来源

第一阶段默认兼容 CodexPlusPlus Themes 市场格式：

```text
index:
https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/index.json

assets:
https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/
```

URL 通过 `createDreamSkinService()` 构造参数注入，不散落在业务代码中。未来可增加其他只读市场 provider。

### 10.2 市场索引模型

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-11T00:00:00Z",
  "themes": [
    {
      "id": "theme-id",
      "name": "Theme Name",
      "version": "1.0.0",
      "author": "Author",
      "description": "Description",
      "license": "MIT",
      "sourceUrl": "https://example.com/source",
      "tags": ["dark"],
      "theme": "themes/theme-id/theme.json",
      "image": "themes/theme-id/background.webp",
      "preview": "themes/theme-id/preview.webp",
      "themeSha256": "64 hex chars",
      "imageSha256": "64 hex chars"
    }
  ]
}
```

同时兼容 snake_case 别名：

- `schema_version`；
- `updated_at`；
- `source_url`；
- `theme_sha256`；
- `image_sha256`。

内部统一标准化为 camelCase。

### 10.3 索引限制

- 最大 1 MiB；
- 最大 200 个主题；
- 主题 ID 不重复；
- 每个字段有长度上限；
- 标签最多 12 个；
- SHA-256 必须为 64 位十六进制；
- `sourceUrl` 只允许 HTTP/HTTPS；
- 资源路径必须是相对路径；
- 拒绝 `..`、反斜杠、绝对路径、查询参数注入和完整远程 URL；
- 资源 URL 只能由受信任的 market base URL 和已校验相对路径拼接。

### 10.4 加载和缓存

加载流程：

1. 请求远程索引；
2. 限制响应大小和超时；
3. 解析和完整校验；
4. 原子写入 `market/index.json`；
5. 合并本地安装状态；
6. 返回远程结果。

远程失败时：

1. 读取本地缓存；
2. 重新校验缓存；
3. 合并安装状态；
4. 返回 `cached: true` 和 warning。

远程和缓存都不可用时返回 `market_unavailable`。

缓存损坏时不返回部分数据，也不覆盖为新空缓存。

### 10.5 网络适配

`market/client.mjs` 不直接依赖网关其他业务模块，而是接收一个受限的请求适配器：

```js
createMarketClient({
  requestBinary,
  indexUrl,
  rawBaseUrl,
  timeoutMs
})
```

网关组装时可注入现有代理配置。测试中注入本地 fake request，无需访问公网。

### 10.6 市场安装

安装流程：

1. 从已校验索引中按 ID 查找主题；
2. 不接受请求体自带 URL、路径或哈希；
3. 下载 `theme.json`；
4. 限制 256 KiB；
5. 校验 SHA-256；
6. 解析并校验主题配置；
7. 确认配置 `id`、`name` 与索引一致；
8. 下载图片；
9. 限制 16 MiB；
10. 校验 SHA-256；
11. 识别真实图片格式；
12. 将 `theme.image` 重写为规范化本地文件名；
13. 通过本地主题库原子安装；
14. 写入安装版本记录。

任何一步失败都不能留下半安装主题。

### 10.7 更新

当：

- 主题已安装；
- 安装记录存在；
- 市场版本与安装版本不同；

则 `updateAvailable: true`。

更新使用与安装相同的完整下载和校验流程，不做增量更新。

如果当前选中的主题被更新：

- 保持 `selectedThemeId` 不变；
- Web 预览刷新到新版本；
- 不触发 Codex runtime。

### 10.8 市场删除

删除市场安装主题使用本地库删除流程。删除成功后移除 `installed.json` 中的记录。

---

## 11. Web API

### 11.1 路由集成

在 `server.js` 中只增加一处前缀分发：

```js
if (reqPath.startsWith("/v1/dream-skin")) {
  return routeDreamSkinRequest(req, res, context, reqPath, {
    service: globalDreamSkinService,
  });
}
```

业务逻辑全部位于 `lib/dream-skin/`。

### 11.2 API 列表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/dream-skin/capabilities` | 返回第一阶段能力开关 |
| GET | `/v1/dream-skin/themes` | 本地主题列表和当前主题 |
| GET | `/v1/dream-skin/themes/:id` | 主题详情 |
| GET | `/v1/dream-skin/themes/:id/image` | 本地主题图片 |
| POST | `/v1/dream-skin/themes` | 创建主题 |
| PUT | `/v1/dream-skin/themes/:id` | 编辑主题 |
| POST | `/v1/dream-skin/themes/:id/duplicate` | 复制主题 |
| POST | `/v1/dream-skin/themes/:id/select` | 设为当前主题 |
| DELETE | `/v1/dream-skin/themes/:id` | 删除主题 |
| POST | `/v1/dream-skin/import` | 导入 JSON 和图片 |
| GET | `/v1/dream-skin/market` | 加载市场，支持缓存降级 |
| POST | `/v1/dream-skin/market/refresh` | 强制重新拉取市场 |
| GET | `/v1/dream-skin/market/themes/:id/preview` | 代理并缓存已校验的市场预览图 |
| POST | `/v1/dream-skin/market/themes/:id/install` | 安装市场主题 |
| POST | `/v1/dream-skin/market/themes/:id/update` | 更新市场主题 |

第一阶段禁止以下路由：

```text
/v1/dream-skin/apply
/v1/dream-skin/launch
/v1/dream-skin/inject
/v1/dream-skin/runtime/*
/v1/dream-skin/community/*
/v1/dream-skin/packages/*
```

这些路径应返回 404，而不是返回“功能关闭”，避免形成可被误调用的运行时入口。

### 11.3 列表响应

```json
{
  "selectedThemeId": "aurora-night",
  "themes": [
    {
      "id": "aurora-night",
      "name": "Aurora Night",
      "kind": "stored",
      "builtin": false,
      "selected": true,
      "source": "market",
      "version": "1.2.0",
      "imageUrl": "/v1/dream-skin/themes/aurora-night/image"
    }
  ]
}
```

响应不暴露本地绝对文件路径。

### 11.4 错误格式

```json
{
  "error": {
    "type": "invalid_theme",
    "message": "主题配置无效",
    "details": [
      {
        "field": "colors.accent",
        "code": "invalid_color"
      }
    ]
  }
}
```

### 11.5 主要错误码

| 错误码 | HTTP 状态 |
| --- | ---: |
| `invalid_request` | 400 |
| `invalid_theme` | 400 |
| `invalid_theme_id` | 400 |
| `invalid_image` | 400 |
| `payload_too_large` | 413 |
| `theme_not_found` | 404 |
| `theme_already_exists` | 409 |
| `theme_in_use` | 409 |
| `builtin_theme_readonly` | 409 |
| `market_unavailable` | 503 |
| `market_manifest_invalid` | 502 |
| `market_asset_invalid` | 502 |
| `hash_mismatch` | 502 |
| `unsupported_feature` | 501，仅供内部扩展接口使用 |
| `storage_error` | 500 |

---

## 12. Web 面板

### 12.1 接入方式

遵循现有 TypeScript 模块化面板：

```text
desktop/src/modules/dream-skin.ts
desktop/src/core/api.ts
desktop/src/styles/panel.css
desktop/index.html
```

`dream-skin.ts` 使用 `registerTab("dream-skin", ...)` 注册生命周期，不把业务代码放回 `app.ts`。

### 12.2 页面结构

Dream Skin 页面包含三个视图：

1. **本地主题**
2. **主题市场**
3. **主题编辑器**

采用标签或分段控件切换，不创建独立营销页。

### 12.3 本地主题视图

展示：

- 主题预览缩略图；
- 名称；
- 引擎标识；
- 来源：内置、本地、市场；
- 已安装版本；
- 当前选择状态；
- 市场更新提示。

操作：

- 查看；
- 设为当前主题；
- 编辑；
- 复制；
- 删除；
- 导入主题。

内置主题不显示删除。当前主题删除按钮禁用并提供原因提示。

### 12.4 市场视图

展示：

- 搜索；
- 标签过滤；
- 市场更新时间；
- 在线或缓存状态；
- 主题预览图；
- 作者；
- 许可证；
- 版本；
- 来源链接；
- 描述；
- 已安装、可更新状态。

市场响应中的 `previewUrl` 必须指向 Shrimp 自己的
`/v1/dream-skin/market/themes/:id/preview`，Web 面板不直接加载索引提供的远程预览地址。预览路由仅使用当前已校验索引中的相对路径下载图片，执行大小、格式和 provider 来源校验后写入 `market/previews/` 缓存；请求体和 URL 参数不能指定任意远程地址。

操作：

- 安装；
- 更新；
- 查看详情；
- 打开来源页面。

安装和更新按钮需要显式点击，不自动下载。

### 12.5 编辑器

编辑器布局：

```text
左侧：受控字段编辑
右侧：模拟工作台预览
```

控件：

- 文本输入：名称和展示文案；
- 下拉菜单：引擎、明暗模式、安全区域、任务背景模式；
- 色板和颜色输入：主题颜色；
- 图片上传：背景图；
- 滑块：焦点 X/Y；
- 重置按钮：恢复当前保存值；
- 保存按钮；
- 另存为按钮。

不提供任意 JSON、CSS 或 JavaScript 编辑框。

### 12.6 模拟工作台预览

预览不复刻 Codex DOM，不加载 renderer-inject.js，而是由 Shrimp 自己渲染稳定结构：

```text
┌──────────┬──────────────────────────────────┐
│ 侧栏     │ 顶部工具栏                       │
│ 项目列表 │                                  │
│ 会话列表 │ 首页欢迎区 / 对话消息            │
│          │                                  │
│          │ 输入框和工具按钮                 │
└──────────┴──────────────────────────────────┘
```

用于观察：

- 背景图构图；
- 安全区域；
- 明暗模式；
- 侧栏和主区域颜色；
- 文本对比度；
- 输入框和按钮状态；
- 首页和对话页两种场景。

预览提供“首页”和“对话”两个标签，不需要连接 Codex。

### 12.7 UI 状态

每个视图必须包含：

- 首次加载；
- 加载失败；
- 空状态；
- 缓存市场提示；
- 安装进行中；
- 保存进行中；
- 删除确认；
- 校验错误；
- 操作成功 toast。

按钮操作期间固定尺寸并禁用，避免重复提交和布局跳动。

---

## 13. 引擎资产集成

### 13.1 内置资源

第一阶段包含：

- `dream-skin`；
- `cidala-tiger`；
- `glass-vision`；
- `snow`。

renderer、CSS 和 LICENSE 保持与已确认的 MIT 上游资源一致。Shrimp 不在资源文件内部插入项目逻辑。

### 13.2 引擎注册表

每个引擎声明：

```js
{
  name,
  rendererFile,
  cssFile,
  version,
  placeholders,
  supportedPresets
}
```

构建器负责：

- 读取资源；
- 注入 CSS；
- 注入图片 data URI；
- 注入主题配置；
- 注入版本和内容签名；
- 检查模板占位符；
- 返回最终 JavaScript 字符串。

### 13.3 签名

内容签名与参考实现保持 32 位 FNV-1a 语义：

```text
<byte-length>-<lowercase-hex-hash>
```

JavaScript 使用 `Math.imul` 保证 32 位溢出行为。

### 13.4 静态验证

对每套引擎测试：

- 资源文件存在；
- LICENSE 存在；
- 模板占位符全部替换；
- runtime 全局变量未被误判为占位符；
- 最终脚本可由 JavaScript 解析器解析；
- 清理脚本可解析；
- 给定相同输入生成稳定签名。

---

## 14. CDP 运行时隔离

### 14.1 第一阶段代码状态

现有 CDP 原型整理到 `runtime/`，但不进入产品调用链。

允许保留和完善：

- loopback 地址校验；
- CDP target 列表解析；
- renderer target 过滤；
- WebSocket 请求和响应关联；
- `Runtime.enable`；
- `Runtime.evaluate` 参数构建；
- CSP 兼容参数；
- 注入脚本注册消息构建；
- cleanup 脚本构建；
- macOS 启动命令纯函数。

### 14.2 禁止行为

第一阶段测试和 Web 面板不得：

- 调用 `open -a`；
- 调用 `kill`、`pkill` 或 AppleScript；
- 检查、退出或重启正在运行的 Codex；
- 监听或扫描真实调试端口；
- 连接真实 CDP WebSocket；
- 调用 `Runtime.evaluate`；
- 注册新文档脚本；
- 修改 Codex 文件。

### 14.3 入口控制

- `runtime/launcher.mjs` 和 `runtime/cdp-client.mjs` 不由 `server.js` 导入；
- package scripts 不提供注入命令；
- Web API 不提供 runtime 路由；
- Web 面板不展示“应用到 Codex”按钮；
- 实验 CLI 第一阶段只支持 `validate` 和 `build-script` 一类离线操作；
- 任何未来运行时启用必须经过新的设计评审。

### 14.4 未来授权模型

未来若启用 Codex 注入，至少要求：

1. 用户在 Web 面板点击明确操作；
2. 弹窗说明会退出并以调试参数重启 Codex；
3. 用户二次确认；
4. 一次性确认令牌；
5. 注入前预检；
6. 注入失败自动清理；
7. 提供显式恢复原界面操作；
8. 不支持后台自动注入。

这部分不属于本设计的实施范围。

---

## 15. 安全设计

### 15.1 信任边界

第一阶段将内容分为：

| 内容 | 信任级别 |
| --- | --- |
| Shrimp 内置 renderer/CSS | 受信任代码资产 |
| 本地和市场 `theme.json` | 不受信任数据 |
| 本地和市场图片 | 不受信任二进制数据 |
| 市场 `index.json` | 不受信任远程数据 |
| 未来 `theme.css` | 未支持 |
| 未来主题包 | 未支持 |

### 15.2 路径安全

- API 只接收主题 ID，不接收本地路径；
- ID 通过严格白名单；
- 所有目标路径由 `themesDir + id` 构造；
- 写入前通过 `path.resolve` 验证仍在主题根目录；
- 拒绝符号链接；
- 市场资源路径禁止路径穿越；
- 图片响应通过主题 ID 查询，不允许任意文件读取。

### 15.3 网络安全

- 市场 URL 从服务端配置获取；
- 安装操作只使用当前已校验索引中的资源信息；
- 客户端请求不能提交任意下载 URL；
- 设置连接和总超时；
- 流式读取并限制最大字节数；
- 发生重定向时，最终 URL 必须仍符合市场 provider 策略；
- 不执行下载内容；
- 下载完成后先校验哈希，再解析或写入正式目录。

### 15.4 HTML 安全

- 主题名称、作者、描述、标签和文案全部使用文本节点或统一 `escapeHtml`；
- 不渲染市场提供的 HTML；
- 不接受 Markdown HTML；
- 背景图片只作为受控图片 URL；
- 预览不使用主题提供的 CSS。

### 15.5 文件权限

- 状态和安装记录采用当前用户可读写权限；
- 临时文件和 staging 不使用全局可写共享目录；
- 保存失败时不放宽权限重试。

### 15.6 许可证

- 每套引擎保留自身 LICENSE；
- `THIRD_PARTY_NOTICES.md` 说明资源来源；
- 市场 UI 显示主题许可证和来源链接；
- 市场主题缺少许可证时拒绝索引；
- 第一阶段本地导入允许用户自用主题不填写许可证，但不提供发布能力。

---

## 16. 错误处理与恢复

### 16.1 读取本地主题失败

单个损坏主题：

- 不阻断整个主题库；
- 在诊断信息中记录；
- 默认列表隐藏损坏主题；
- API 可返回 `invalidEntries` 数量；
- 不自动删除。

### 16.2 当前主题损坏或不存在

- 回退选择到 `shrimp-default`；
- 原子修复 `state.json`；
- 返回 warning；
- 不触发 runtime。

### 16.3 市场缓存损坏

- 不使用损坏缓存；
- 远程成功时覆盖为有效缓存；
- 远程失败时返回 `market_unavailable`；
- 不返回空市场冒充成功。

### 16.4 安装中断

- 正式主题目录不出现半成品；
- 下次启动清理过期 `.staging`；
- backup 存在而正式目录缺失时执行恢复；
- 所有恢复操作记录警告。

### 16.5 更新失败

- 保留旧版本；
- 安装记录不变；
- 当前主题选择不变；
- UI 显示具体错误。

---

## 17. 测试策略

### 17.1 领域单元测试

- ID 合法和非法边界；
- schema 版本；
- 字段长度；
- 枚举；
- 颜色；
- 路径字段；
- 兼容字段标准化；
- 图片格式识别；
- 引擎映射。

### 17.2 本地库测试

使用临时目录测试：

- 空主题库；
- 创建、编辑、复制、选择和删除；
- 内置主题只读；
- 当前主题禁止删除；
- 重名冲突；
- 非法目录；
- 符号链接；
- 损坏 JSON；
- 多图片；
- staging 回滚；
- 更新回滚；
- 并发 mutation 排队。

### 17.3 市场测试

使用注入的 fake request：

- 正常索引；
- snake_case 兼容；
- 重复 ID；
- 超大索引；
- 非法路径；
- 非法 URL；
- 网络失败使用缓存；
- 缓存损坏；
- 主题哈希不匹配；
- 图片哈希不匹配；
- 主题身份不一致；
- 图片伪装；
- 安装和更新；
- 更新失败保留旧版本。

### 17.4 HTTP 集成测试

- 路由方法和状态码；
- 请求体上限；
- 错误格式；
- 不暴露本地路径；
- 图片读取；
- 创建、编辑、选择和删除完整流程；
- 市场安装完整流程；
- runtime、community 和 package 路由返回 404。

### 17.5 Web 面板测试

- 本地主题列表渲染；
- 市场在线和缓存状态；
- 搜索和标签过滤；
- 安装、更新和删除状态；
- 编辑器字段；
- 图片上传；
- 首页和对话预览；
- 明暗主题；
- 窄屏和宽屏；
- 长名称、长作者和长标签不溢出；
- 错误提示和重复点击保护。

### 17.6 Runtime 静态测试

- 四套引擎构建；
- 最终 JavaScript 语法；
- 内容签名；
- CDP 消息序列化；
- target 过滤；
- loopback 地址拒绝；
- macOS 命令参数纯函数。

Runtime 测试必须 mock：

- `child_process`；
- HTTP；
- WebSocket；
- 端口；
- 进程检查。

不得把真实 Codex 注入作为第一阶段验收项。

---

## 18. 可观测性

Dream Skin 统一日志前缀：

```text
[dream-skin]
```

记录：

- 市场刷新成功或缓存降级；
- 安装、更新和删除结果；
- staging 恢复；
- 损坏主题数量；
- 错误码和主题 ID。

不记录：

- 图片内容；
- 完整 Base64；
- 用户本地绝对路径到 API 响应；
- 主题 JSON 中可能包含的私人文案全文。

---

## 19. 实施顺序

### 阶段 1：领域和存储

1. 整理路径模块；
2. 实现主题 schema、ID 和图片校验；
3. 实现本地主题库；
4. 实现当前主题状态；
5. 实现本地导入；
6. 完成本地库测试。

### 阶段 2：市场

1. 市场 schema；
2. 请求适配器；
3. 索引缓存和离线降级；
4. 安装记录；
5. 安装和更新；
6. 市场测试。

### 阶段 3：应用服务和 HTTP

1. 应用服务；
2. 独立路由；
3. server 前缀接入；
4. HTTP 集成测试。

### 阶段 4：Web 面板

1. Dream Skin 标签页；
2. 本地主题视图；
3. 市场视图；
4. 编辑器；
5. 模拟工作台预览；
6. 前端测试和响应式检查。

### 阶段 5：Runtime 静态收口

1. 将现有原型整理到 `runtime/`；
2. 校准四套引擎构建；
3. 完善纯函数和 mock 测试；
4. 移除正常产品调用入口；
5. 确认没有真实启动和注入测试。

---

## 20. 工时估算

| 模块 | 估算 | 说明 |
| --- | ---: | --- |
| 引擎资产集成 | 0.5-1 天 | 已有基础，主要是整理和补测试 |
| 主题领域模型和校验 | 1 天 | schema、ID、颜色、图片 |
| 本地主题库 | 1-1.5 天 | CRUD、选择、原子写入、回滚 |
| 本地导入 | 0.5 天 | JSON + 图片 |
| 主题市场 | 1-1.5 天 | fetch、缓存、校验、离线降级 |
| 安装、更新和删除 | 1 天 | SHA-256、原子安装、版本记录 |
| 应用服务和 HTTP API | 1 天 | 独立路由和集成测试 |
| Web 面板 UI | 2-3 天 | 本地库、市场、编辑器、预览 |
| Runtime 静态适配 | 0.5-1 天 | 不做真实注入 |
| 测试和安全审查 | 1.5-2 天 | 恶意输入、回滚、前端检查 |

**总估算：10-13.5 个工程日。**

不包含：

- ZIP 安全主题包；
- Safe CSS；
- 社区上传和审核；
- 真实 Codex 注入和跨版本兼容测试；
- Windows/Linux runtime；
- 主题云同步。

---

## 21. 未来扩展

### 21.1 ZIP 主题包

未来 `package-provider` 支持：

- ZIP 文件数量和大小限制；
- 解压后总大小限制；
- 路径穿越；
- 符号链接；
- `manifest.json`；
- 文件哈希；
- 发布者和来源；
- 可选签名。

它输出标准主题草稿，再交给本地主题库安装。

### 21.2 Safe CSS

未来 `css-compiler` 支持：

- 只允许 Skin API 的 `data-ds-part`；
- 选择器白名单；
- CSS 属性白名单；
- 属性值解析；
- CSS 变量白名单；
- 规则和声明数量限制；
- 禁止 URL、导入、字体、脚本、动画滥用和 `!important`；
- 编译到受控 cascade layer。

在 Safe CSS 完成前，任何 `theme.css` 都拒绝处理。

### 21.3 社区服务

未来 `community-provider` 支持：

- 登录；
- 上传；
- 草稿；
- 审核状态；
- 举报；
- 发布；
- 版本管理。

主题市场第一阶段保持只读，不预留隐藏上传接口。

### 21.4 Codex Runtime

未来单独设计：

- Codex 版本识别；
- 用户显式确认；
- 预检；
- 启动和调试端口；
- 注入；
- 运行状态验证；
- 失败清理；
- 恢复原界面；
- 热更新；
- DOM 兼容矩阵；
- macOS 和 Windows 差异。

---

## 22. 第一阶段验收标准

第一阶段完成时必须满足：

1. Dream Skin 数据跟随 `GATEWAY_CONFIG_FILE` 所在目录；
2. 四套引擎资产有 LICENSE 和静态构建测试；
3. 本地主题可以创建、编辑、复制、导入、删除和选择；
4. Web 面板可以浏览本地主题；
5. Web 面板可以在模拟工作台中预览主题；
6. Web 面板可以编辑受控颜色、图片和布局参数；
7. 市场可以在线加载并在失败时使用有效缓存；
8. 市场主题安装前验证配置和图片 SHA-256；
9. 市场主题可以安装、更新和删除；
10. 所有文件变更采用 staging 和原子替换；
11. API 不接受任意路径或下载 URL；
12. API 不返回本地绝对路径；
13. ZIP、CSS、JavaScript 和远程主题资源被明确拒绝；
14. 不存在启动、注入或应用到 Codex 的 Web API；
15. Web 面板不存在注入按钮；
16. 自动测试不会启动、退出、重启或连接 Codex；
17. 网关正常启动不导入 runtime launcher/CDP 模块；
18. 现有网关功能和测试不回归。

---

## 23. 评审重点

后续对接时重点确认：

1. 第一阶段是否需要“从空白创建主题”，还是只允许复制和导入；
2. 市场主题编辑是否采用“自动另存为本地副本”；
3. 当前主题是否禁止删除；
4. 市场默认 URL 是否直接使用 CodexPlusPlus Themes；
5. 本地导入是否接受 Base64 JSON 协议；
6. 预览是否保留“首页”和“对话”两个场景；
7. Runtime 第一阶段是否完全移除可执行入口；
8. 10-13.5 个工程日的范围是否可接受。
