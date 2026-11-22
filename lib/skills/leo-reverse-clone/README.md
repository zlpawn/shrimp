# leo-reverse-clone（逆向拆解与 1:1 复刻制作路由中枢）

`leo-reverse-clone` 是符合 Shrimp 网关规范的**薄路由 + 无头常驻 MCP 桥接技能**，统一纳管 **`rea-agents`** 与 **`craft-anything-cli`** 两个开源逆向/重构引擎：

- **零全局 MCP 污染**：不向 Claude Code / Codex / Cursor / Antigravity 全局配置写入 MCP，不运行 `rea setup` / `craft-anything-cli setup`；而是通过 `uv run scripts/mcp_bridge.py` 按需在后台拉起常驻 MCP 服务端并复用会话（REA 走原生 Streamable HTTP，Craft Anything 走本地 Loopback Token Broker 握住 stdio 管道）。
- **零重复说明书**：直接按需加载已安装的官方下游 Skill（`reverse-engineer-anything` 与 `craft-anything`），缺失时询问用户同意后再自动下载。
- **免编译安装**：`craft-anything-cli` 直接下载官方 GitHub Releases 预编译单文件 CLI（不装 `.dmg`、不装 Rust/Cargo）；`rea-agents` 通过 npm 安装。
- **AI 主导全流程，用户只验收**：工程统一落盘至 `~/素材/reverse-clone/<类别>/YYYY-MM-DD/<目标名称>/`（含 `source/`、`evidence/`、`spec.md`、`app/`、`verify/`）。

## 常用脚本

```bash
# 1. 探测引擎、官方下游 Skill 与可选依赖（JDK/JADX/Ghidra/ADB）
node scripts/probe.mjs
node scripts/probe.mjs --check-updates

# 2. 查看安装计划（dry-run）或在确认后一键下载引擎与官方 Skill
node scripts/install.mjs --engine all
node scripts/install.mjs --engine rea --yes
node scripts/install.mjs --engine craft-anything --yes

# 3. 常驻 MCP 桥接客户端（不污染全局 Agent MCP 配置）
uv run scripts/mcp_bridge.py status
uv run scripts/mcp_bridge.py start rea
uv run scripts/mcp_bridge.py tools rea --format markdown
uv run scripts/mcp_bridge.py call rea inspect_android_package '{"path":"/abs/app.apk"}'
uv run scripts/mcp_bridge.py start craft --deep
uv run scripts/mcp_bridge.py enable-toolset craft android
uv run scripts/mcp_bridge.py call craft android_package_show '{"path":"/abs/app.apk"}'
uv run scripts/mcp_bridge.py stop all

# 4. 归档目录配置与工程初始化（持久化至 ~/.shrimp/skills/leo-reverse-clone/config.json）
node scripts/config.mjs get
node scripts/config.mjs set --dir "~/素材/reverse-clone"
node scripts/config.mjs init --cat apk --name DemoApp --engine rea
```

## 安装到全局 Agent Skill 目录

```bash
cp -r "lib/skills/leo-reverse-clone" ~/.agents/skills/
ln -sfn ~/.agents/skills/leo-reverse-clone ~/.gemini/config/skills/leo-reverse-clone
```
