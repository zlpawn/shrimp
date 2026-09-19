# 网关技能开发规范与标准指南 (Gateway Skills Standard)

本目录（`lib/skills/`）存放网关所有受管与自定义技能（前缀均为 `leo-*`）。为确保所有接入网关的 AI Agent（包括 Antigravity、Codex、Claude Code 等）能够高效协作并产出工业级成果，特制定以下全局开发与运行规范：

---

## 核心原则 1：效果优先，不限语言 (Best-Tool-First & Language-Agnostic)

网关技能**绝对不限制使用单一编程语言**。任何 Agent 在设计或实现技能时，必须遵循**“以产出效果的最佳质量为唯一衡量标准”**：
* **网络请求、CLI 交互、轻量工具**：优先选用 Node.js (`.js` / `.mjs`)，与网关核心环境保持高效共存；
* **文档排版、Office 处理（PPT/Word/Excel）、数据分析、科学计算与专业 AI 算法**：**首选且推荐使用 Python**，充分发挥 Python 生态在该领域的绝对统治力和排版效果；
* **高性能底层、跨平台独立单二进制**：可选 Go 或 Rust。

---

## 核心原则 2：全面采用现代化极速工具链 `uv` (Fast Python Tooling)

在所有涉及 Python 的技能中，**严禁使用陈旧、缓慢的传统 `pip` 命令**，一律全面接入高性能 Rust 编写的 **`uv`** 工具链：

1. **安装依赖**：
   * 必须使用：`uv pip install <package>`，而非 `pip install <package>`。
2. **脚本执行与依赖隔离 (PEP 723)**：
   * 推荐在独立 Python 脚本头部声明标准 PEP 723 元数据：
     ```python
     # /// script
     # requires-python = ">=3.10"
     # dependencies = [
     #     "python-pptx",
     # ]
     # ///
     ```
   * 运行方式统一采用：`uv run scripts/<script_name>.py`。
   * **优势**：`uv run` 会自动根据头部声明临时装载依赖，零污染全局环境，且在 macOS 与 Windows 上秒级极速执行。

---

## 核心原则 3：100% 跨平台代码规范 (Windows & macOS Universal)

所有脚本必须原生支持 **Windows** 与 **macOS**：
* **文件路径**：
  * Node.js 中必须统一使用 `node:path`（`path.join`、`path.resolve`），禁止硬编码斜杠或反斜杠；
  * Python 中必须统一使用 `pathlib.Path` 处理路径，禁止直接进行字符串路径拼接；
* **终端与系统调用**：
  * 调起系统默认程序（如打开网页、文件）需通过平台嗅探自适应分流（`process.platform` 或 `sys.platform`），适配 `start` / `open` / `xdg-open`；
  * 换行符一律按操作系统标准解析，文件读写强制指定 `encoding="utf-8"`。

---

## 技能目录结构标准

每个 `leo-*` 技能目录应遵循标准布局：
```
lib/skills/leo-<name>/
├── SKILL.md            # Agent 技能规范（YAML frontmatter: name, description）
├── package.json        # 技能元数据与启动命令清单
├── agents/             # （可选）多智能体分工规范
├── references/         # （可选）静态设计资产、提示词规范、风格配置
└── scripts/            # 执行脚本（Node.js 或 Python + uv）
```
