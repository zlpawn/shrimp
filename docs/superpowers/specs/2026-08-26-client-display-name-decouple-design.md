# 代理节点展示名称（Display Name）与路由标识（Route Slug）解耦设计规范

## 1. 背景与目标

### 1.1 现状与痛点
当前 Shrimp 本地网关中，自定义代理节点（Custom Client）的展示名称与路由路径前缀是 **1:1 强绑定** 的：
1. **标识与路径合一**：在 UI 中创建节点时，输入的名称经 `slugify` 后直接作为 `gateway.config.json` 中 `config.clients` 的 Key，同时也作为客户端请求网关的唯一 URL 路由路径（如 `http://127.0.0.1:8787/work-buddy/`）。
2. **显示受限**：侧边栏与页面标题直接显示该 Key，不支持中文、空格或更具辨识度的业务友好名称（如「办公助手 (Work Buddy)」、「生产知识库 Agent」）。
3. **改名风险**：一旦想要修改展示名称，会导致底层的路由 Key 变更，下游已配置的客户端（如 Cursor / LangChain / Cherry Studio）的 `base_url` 就会失效。

### 1.2 目标
1. **概念与数据解耦**：将「显示名称（Display Name）」与「路由标识（Route Slug）」彻底解耦。
   - **路由标识（Route Slug）**：必须是 URL 安全的标识符（小写英文字母、数字、连字符），作为 `config.clients` 的主键以及 HTTP 路由前缀（`http://127.0.0.1:8787/{slug}/`），一经创建保持稳定。
   - **显示名称（Display Name）**：支持任意字符（中文、英文、符号、空格），用于侧边栏、页面大标题、下拉菜单选择等所有 UI 场景，支持随时重命名。
2. **向后完全兼容**：若历史配置未设置 `display_name`，系统无缝自动 fallback 到 key，不破坏任何现有配置与测试。
3. **良好交互体验**：新建节点弹窗提供显示名称与路由标识的智能联动（自动生成 slug，亦可手动微调）；支持在节点详情页头部一键重命名。

---

## 2. 数据结构设计

### 2.1 `gateway.config.json` 架构变更
在 `config.clients[slug]` 对象中增加可选字段 `display_name`：

```json
{
  "clients": {
    "code": { ... },
    "desktop": { ... },
    "codex": { ... },
    "deeptutor": { ... },
    "work-buddy": {
      "display_name": "我的办公助手",
      "protocol": "openai",
      "endpoints": [ ... ]
    }
  }
}
```

* `display_name` (string, 可选): 用户自定义的显示别名。长度限制 1~60 字符。
* 若 `display_name` 为空或未设置，系统自动回退至 `slug` 键名。

---

## 3. 核心功能与模块设计

### 3.1 客户端显示名称解析器 (`clientDisplayName`)
更新 `desktop/src/app.ts` 中的 `clientDisplayName` 函数：

```typescript
function clientDisplayName(client: string): string {
    const key = String(client || '').trim();
    if (!key) return '';
    // 1. 如果是自定义节点且配置了 display_name，优先使用
    const customDisplayName = config.clients?.[key]?.display_name;
    if (customDisplayName && typeof customDisplayName === 'string' && customDisplayName.trim()) {
        return customDisplayName.trim();
    }
    // 2. 如果是内置节点（code / desktop / codex / deeptutor），使用标准中文名
    if (CLIENT_DISPLAY_NAMES[key]) {
        return CLIENT_DISPLAY_NAMES[key];
    }
    // 3. 兜底回退为 key 本身
    return key;
}
```

所有全局引用处（侧边栏导航 `renderCustomClientNav`、页面大标题 `renderCustomClientSections`、Session 看板、用量统计、Mini-tools 选择器等）将自动享受友好的中文/自定义名称。

### 3.2 新建代理节点交互 (`#client-create-modal`)
1. **表单输入项**：
   * **显示名称** (`input#client-create-display-name`)：如「我的办公助手」。
   * **路由标识 (Slug)** (`input#client-create-slug`)：如「work-buddy」。附带实时说明文本：“用于 API 入口: `http://127.0.0.1:8787/{slug}/`”。
   * **接入协议** (`select#client-create-protocol`)：OpenAI 兼容 / Anthropic。
   * **创建模式**：空白节点 / 复制已有节点。
2. **智能联动逻辑**：
   * 用户在「显示名称」输入框输入内容时，若「路由标识」尚未被用户手动修改，则自动对显示名称进行 `slugifyClientName` 填入；
   * 用户可随时点击并手动编辑「路由标识」；一旦手动编辑，「路由标识」将锁定为手动输入的值。

### 3.3 重命名代理节点功能 (`renameCustomClient`)
1. **交互入口**：在自定义节点详情页面的顶部标题右侧增加「重命名」按钮。
2. **逻辑处理**：
   * 弹出轻量 prompt 或输入框，用户输入新的 `display_name`；
   * 校验通过后，更新 `config.clients[client].display_name = newName`；
   * 调用 `saveConfig({ client, scope: 'client' })` 保存；
   * 保存成功后调用 `render()` 刷新页面及侧边栏，弹出成功 Toast。

### 3.4 后端与 CLI 支持
1. **网关配置接口 (`server.js`)**：
   * `POST /v1/config/add-client` 接收 `displayName` 参数并持久化到新 client 对象中。
   * 支持通过通用配置保存接口更新 `display_name`。
2. **Shrimp CLI (`lib/clis/shrimp/`)**：
   * `shrimp client add <slug> [--name <display_name>] [--protocol <protocol>] [--from <source>]`：支持指定展示名称。
   * `shrimp client list`：返回列表包含 `display_name`。
   * `shrimp client rename <slug> <new_display_name>`：支持命令行快速重命名。

---

## 4. 测试与验证策略

1. **单元测试 (Unit Tests)**：
   * `tests/unit/gateway-config-store.test.mjs` & `tests/unit/config-panel.test.mjs`：
     - 测试 `display_name` 的存储、读取与 fallback 逻辑。
     - 测试 `clientDisplayName` 对自定义节点 `display_name`、内置节点、缺失字段情况下的返回值。
     - 测试添加带有 `displayName` 的 client。
   * `tests/unit/clis/shrimp/client-copy-service.test.mjs`：
     - 测试 CLI `client add` 携带 `--name` 及 `client list` 输出。
2. **集成与端到端测试 (Integration Tests)**：
   * 验证重命名后，原有的 API 请求路径（如 `POST /work-buddy/chat/completions`）不受任何影响正常工作。
   * 验证前端 Web 面板各处（侧边栏、页面头、下拉菜单）一致性渲染。
