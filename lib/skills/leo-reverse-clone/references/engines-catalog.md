# 双引擎能力画像与路由速查（Engines Catalog）

本档案记录 `leo-reverse-clone` 纳管的两个逆向与复刻底层引擎：**`rea`**（`rea-agents`）与 **`craft-anything`**（`craft-anything-cli`）。

本档案仅用于**动态路由选优、环境探测与 JIT 下载指引**；具体逆向操作方法论与工具参数规范，**一律以对应引擎的官方下游 Skill 为准**。

---

## rea（`rea-agents`）

- **核心定位**：专业级深度逆向 MCP 基础设施（Node.js + 多语言 Bridge），擅长桥接业界重型成熟反编译/动态工具。
- **官方下游 Skill**：`reverse-engineer-anything`
  - 仓库来源：`https://github.com/morluto/rea`（路径 `.agents/skills/reverse-engineer-anything/`）
  - 一键安装：`node scripts/install.mjs --engine rea --yes`（或 `npx -y skills add morluto/rea --skill reverse-engineer-anything`）
- **可执行入口与 MCP 传输**：
  - 安装命令：`npm install --global rea-agents`（或 `npx -y rea-agents@latest` 临时运行）
  - 常驻桥接方式：`mcp_bridge.py` 自动在后台拉起原生 **`rea mcp --http --host 127.0.0.1 --port 0`**，跨调用复用同一个 `Mcp-Session-Id`（保留热加载 JADX / Ghidra 会话与 `evidence://<id>` 内存证据池）。
- **核心优势场景（何时优先选 `rea`）**：
  1. **Android APK 深度逆向**：常驻热加载 `jadx-headless-mcp` 输出完整 Java 源码、支持 R8/ProGuard `mapping.txt` 反混淆映射、`inspect_android_jni_bindings` 精准关联 Java `native` 声明与 `.so` 静态 `JNINativeMethod` 表及 APS2 重定位；
  2. **重型专业二进制反编译**：桥接本地已安装的 **IDA Pro / Hex-Rays、Hopper、Ghidra、Kuna**，以及 Linux `pwntools` / `pwndbg` 崩溃转储分析；
  3. **专项格式与网络/RL 环境**：CUDA/HIP GPU 代码对象、DWARF、Linux `.ko`、Erlang BEAM、Deno 独立程序、mitmproxy/SAZ 抓包、以及导出 AgentEnv RL 评测环境。
- **常见可选外部依赖**：
  - Node.js `22.23.4+` / `24.22.1+` / `26.12.1+`
  - 深度 APK 逆向：完整 **JDK 17+** + `REA_JADX_MCP_JAR`（`jadx-headless-mcp` JAR）
  - 深度二进制逆向：Hopper / Ghidra / IDA / Kuna 任选其一

---

## craft-anything（`craft-anything-cli`）

- **核心定位**：100% 纯 Rust 零依赖静态逆向底座 + 净室/深度双模式自动化复刻重构引擎。
- **官方下游 Skill**：`craft-anything`
  - 仓库来源：`https://github.com/storytold/craft-anything`（路径 `crates/setup/src/skill.md`）
  - 一键安装：`node scripts/install.mjs --engine craft-anything --yes`（自动从 GitHub Releases 免编译下载纯 CLI 二进制 + 同步官方 `SKILL.md`，绝不安装 `.dmg`、绝不修改全局 MCP 配置）
- **可执行入口与 MCP 传输**：
  - 安装方式：GitHub Releases 预编译纯 CLI 单文件（落盘至 `~/.local/bin/craft-anything-cli` / Windows `%USERPROFILE%\.local\bin\craft-anything-cli.exe`），无需 Rust/Cargo 编译。
  - 常驻桥接方式：由于 `craft-anything-cli mcp` 仅支持 stdio，`mcp_bridge.py` 在后台拉起轻量本地 Loopback Broker（带随机 Token 鉴权 + 闲置自动回收）长期握住 `craft-anything-cli mcp --deep` 的 stdio 管道，完整保留打开的目标、浏览器连接、`enable_toolset` 状态与内存证据池。
- **核心优势场景（何时优先选 `craft-anything`）**：
  1. **零外部依赖秒级静态拆解**：本机没装 JDK / JADX / IDA / Ghidra 时，纯 Rust 开箱即用拆解 ELF / PE / Mach-O（内置反汇编 + **Pseudo-C 伪代码抬升**）、APK（Manifest/验签/AXML/`resources.arsc`/Smali/Flutter Dart AOT Snapshot）、Unity IL2CPP / Unreal Pak / Godot PCK、ASAR / PyInstaller；
  2. **网站与轻桌面/小游戏 1:1 视觉与行为复刻**：内置 `web_site_open` / `web_site_capture`（多分辨率截图 + 弹窗菜单态 + HAR 录包转本地 `StandIn` 替身后端）以及 `craft-anything-cli rebuild` 自动化 `Study → Build → Check → Refine` 闭环；
  3. **合规隔离（Clean Room 模式）**：当需求明确禁止读取目标内部代码/源码、仅允许从外部视觉与交互行为复刻时，启动 `mcp_bridge.py start craft --clean-room`。

---

## 动态选优与双引擎协同原则（非硬编码）

| 目标与任务特征 | 推荐首选 | 协同 / 兜底策略 |
| :--- | :--- | :--- |
| **Android APK 深度逆向 + 复刻**（本机有 JDK + JADX） | **`rea`** | 先用 `craft-anything` 秒拆 `resources.arsc` 多语言资源/布局/验签，再用 `rea` 读 Java 源码与 JNI 绑定 |
| **Android APK 快速拆包 / 无 JDK 环境 / 看 Flutter 或 `.so` 伪代码** | **`craft-anything`** | 零依赖直接出 Manifest、组件暴露面、资源、Smali 与内置 ARM64 Pseudo-C |
| **网站 / Web 应用 1:1 复刻**（需要多宽截图对比 + Mock 后端） | **`craft-anything`** | 走 `craft` 常驻浏览器抓图 + `web_standin_build` 替身后端，或直接跑 `craft-anything-cli rebuild` |
| **原生二进制 / 桌面软件**（有 IDA / Hopper / Ghidra） | **`rea`** | 无重型反编译器时直接用 `craft-anything` 内置 Pseudo-C 引擎零依赖顶上 |
| **Unity / Unreal / Godot 游戏资产与逻辑拆解** | **`craft-anything`** | `game_*` 工具集拆包与 IL2CPP 还原 |
| **Electron / JS Bundle 拆解与复刻** | **两者皆可**（优先看已就绪引擎） | 复杂跨版本/源码对齐优先 `rea`；配合网站视觉抓图优先 `craft-anything` |
