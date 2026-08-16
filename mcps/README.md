# 🚀 自研 MCP 服务开发与结构规范指南 (In-Repo Custom MCP Guide)

本文档作为**所有 AI 编码助手（如 Antigravity / Claude / Cursor / Codex）及人类开发者**在当前项目中创建与维护自研 MCP 的**唯一标准规范**。

---

## 📌 一、 核心设计理念

1. **统一仓库维护（Monorepo）**：所有自研 MCP 源码均存放于 `mcps/<mcp-name>/` 目录下，与网关在同一个 Git 仓库中协同管理。
2. **零耦合独立运行（Decoupled Standalone）**：每个自研 MCP 都是一个**完全自治的独立子项目**。即使网关主服务彻底关闭，客户端（Codex / Claude 等）拉起子进程也能 100% 独立运行。
3. **网关零编译侵入**：网关只负责**扫描文件结构、生成分发配置、一键写入客户端**，不会打包、编译或干扰各个自研 MCP 的独立源码。

---

## 📁 二、 目录结构与自动感知规范

当你在 `mcps/` 目录下新建子文件夹时，网关的「MCP 枢纽」会自动探测并提取启动命令。请务必遵循以下**三种主流语言的文件入口命名规范**：

### 1. Node.js / TypeScript 自研 MCP

- **推荐目录结构**：
  ```text
  mcps/my-node-tool/
  ├── package.json          # 独立声明依赖（如 @modelcontextprotocol/sdk）
  └── index.mjs             # 入口文件（或 index.js）
  ```
- **网关自动探测规则**：
  - 若存在 `index.mjs`、`index.js` 或 `package.json`；
  - 网关将自动识别为 **Node.js MCP**；
  - 自动生成的启动命令为：`node ./mcps/<mcp-name>/index.mjs`。

---

### 2. Python FastMCP 自研 MCP

- **推荐目录结构**：
  ```text
  mcps/my-py-tool/
  ├── pyproject.toml        # 或 requirements.txt（声明 fastmcp 等依赖）
  └── server.py             # 入口文件（或 main.py / app.py）
  ```
- **网关自动探测规则**：
  - 若存在 `server.py`、`main.py` 或 `pyproject.toml`；
  - 网关将自动识别为 **Python FastMCP**；
  - 自动生成的启动命令为：`uv run --directory ./mcps/<mcp-name> server.py`（使用 `uv` 实现零污染环境隔离）。

---

### 3. Java / Native 自研 MCP

- **推荐目录结构**：
  ```text
  mcps/my-java-tool/
  ├── pom.xml               # 或 build.gradle
  └── target/
      └── app.jar           # 打包好的独立可执行 Fat-JAR
  ```
- **网关自动探测规则**：
  - 若存在 `pom.xml` 或 `target/*.jar`；
  - 网关将自动识别为 **Java MCP**；
  - 自动生成的启动命令为：`java -jar ./mcps/<mcp-name>/target/app.jar`。

---

## 🛠️ 三、 新建自研 MCP 的标准工作流

### 给 AI 助手 / 开发者的操作指令：

1. **新建子目录**：在 `mcps/` 下创建你的 MCP 名称目录，如 `mcps/database-viewer/`；
2. **编写代码与依赖**：
   - 依照上述语言规范创建入口文件（如 `index.mjs` 或 `server.py`）；
   - 使用官方标准 SDK（`@modelcontextprotocol/sdk` 或 `fastmcp`）实现工具（Tools）、资源（Resources）与提示词（Prompts）；
3. **打开网关界面**：
   - 访问网关面板中的 **「MCP 枢纽 (MCP Hub)」**；
   - 页面左侧 **「🚀 本地自研 MCP」** 列表中会自动实时出现该工具卡片；
4. **一键分发**：
   - 点击该卡片，在右侧勾选需要分发的客户端（OpenAI Codex / Claude Desktop / Claude Code / Antigravity）；
   - 点击 **「保存配置」** 并 **「一键写入客户端」** 即可立即生效！

---

## 🔒 四、 环境变量与私密变量管理

- **通用配置（公开）**：自动保存于项目根目录的 `mcp.config.json` 中；
- **敏感密钥（私密）**：若 MCP 需要访问数据库或私密 Token，配置中的私密变量会自动保存在项目根目录的 `mcp.secrets.json`（该文件已被 `.gitignore` 忽略，物理隔离不入库）。
