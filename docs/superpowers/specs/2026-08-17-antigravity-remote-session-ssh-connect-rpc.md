# Antigravity Remote Session (SSH + Connect RPC) 架构与技术实现文档

**更新日期：** 2026-08-17  
**分支：** `codex/antigravity-remote-session`  
**核心特性：** 远程无感协同、SSH Stdin-Piping 探测、Language Server Connect RPC 接入、多工作区工程自动嗅探、历史对话看板与会话实时接入

---

## 1. 架构总览与分层设计

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        控制端 (Local / Windows 11)                      │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Shrimp Gateway (端口 8789)                                       │  │
│  │   • HTTP Routes: /v1/remote-session/*                            │  │
│  │   • Application Service: openSession / dispatchPrompt / inspect  │  │
│  │   • SSH Host Backend (ssh-host.mjs): Stdin-Piping RPC Client     │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ SSH (frp 穿透 / 直连端口 6007)
                                     │ 安全管道传输 JS Script Payload
┌────────────────────────────────────▼───────────────────────────────────┐
│                        受控端 (Remote / macOS - mac-pa)                │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Antigravity Language Server (端口 55116, CSRF Auth)              │  │
│  │   • GetCascadeModelConfigData (实时动态模型与额度)                │  │
│  │   • StartCascade (远程会话创建与挂接)                             │  │
│  │   • SendUserCascadeMessage (指令与模型下发)                       │  │
│  │   • GetCascadeTrajectory (实时思考流与工具执行轨迹)               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Antigravity Filesystem Storage                                   │  │
│  │   • ~/.gemini/antigravity/brain/<id>/.../transcript.jsonl        │  │
│  │   • ~/project/* (47+ 真实工程仓库)                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心技术突破与设计方案

### 2.1 SSH Stdin-Piping 无转义远程执行机制 (`ssh-host.mjs`)
- **传统命令行拼接痛点**：通过 `ssh user@host "node -e '...'"` 执行复杂 Node.js 脚本时，跨平台（Windows CMD/PowerShell ➔ Linux/macOS Bash/Zsh）的单双引号、换行符 `\n` 和正则转义极易引发语法崩溃或截断。
- **Stdin-Piping 解决方案**：
  使用 `child = spawn('ssh', [..., 'node'])`，直接将待执行脚本写入标准输入 `child.stdin.write(script); child.stdin.end()`。
  - 零转义损耗，支持任意复杂正则、多行代码与 JSON 数据结构；
  - 结合 `SSH_ASKPASS` 动态凭证文件，实现密码与公钥自动静默鉴权。

### 2.2 Antigravity Language Server Connect RPC 直连
- **动态探测机制**：受控端无需开放任何额外 HTTP 端口。脚本在受控端本地通过 `ps aux | grep language_server` 动态获取：
  1. 进程 PID；
  2. `--csrf_token` 令牌；
  3. 通过 `lsof -Pan -p <pid> -i` 获取内部监听端口（如 `55116`）。
- **支持的核心 RPC 端点**：
  1. `/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigData`：
     实时获取当前受控端已开通的 14 个在线模型（包含 `remainingFraction` 剩余额度与 `Fast` 标识），彻底告别写死模型列表。
  2. `/exa.language_server_pb.LanguageServerService/StartCascade`：
     传入 `workspaceUri`，在远端 Antigravity 原生创建 Cascade 任务，返回真实 `cascadeId` 与 `trajectoryId`。
  3. `/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage`：
     向远端会话下发用户 Prompt 与指定模型配置（如 `MODEL_PLACEHOLDER_M298`），驱动远端引擎生成。
  4. `/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory`：
     获取会话完整 Steps 轨迹、工具调用入参与返回结果。

### 2.3 工作区项目与历史会话智能归属嗅探
- **递归仓库扫描**：自动递归扫描受控端 `~/project` 与用户目录下的所有 Git 仓库、`package.json`、`pom.xml`、`go.mod`、`Cargo.toml` 等工程标识，精准识别 47+ 个独立工作区。
- **会话与工程智能匹配**：分析 `transcript.jsonl` 中记录的文件操作路径、命令目录与工作区 URI，将 85+ 历史会话准确归属于各子工程下（如 `local-ai-gateway`、`cangjie`、`iot-platform` 等）。
- **最近活跃加权排序（Recency-First）**：
  - **项目排序**：最近活跃更新（`bLatest - aLatest`）> 会话总数 > 字母顺序；
  - **会话排序**：第一项置顶 `✨ + 新建独立会话`，历史会话按最后更新时间严格倒序并标注时间标签（如 `10m 前`、`2h 前`、`1d 前`）。

### 2.4 执行模型智能分级排序（Gemini 首选）
模型下拉列表自动按权重排序：
1. **Gemini 家族优先**：`3.7` ➔ `3.6` ➔ `3.5` ➔ `3.1`，同版本内按 `High (Fast)` ➔ `Medium (Fast)` ➔ `Low (Fast)` 排序；
2. **Claude 家族次之**：`Claude Sonnet 4.6 (Thinking)` ➔ `Claude Opus 4.6 (Thinking)`；
3. **开源与第三方模型居后**：`GPT-OSS 120B (Medium)` 等。

### 2.5 极简无感交互（零额外点击）
- **移除冗余按钮**：移除了顶部「新建 / 接入会话」手动按钮；
- **选择即接入**：在会话下拉框选中某条历史会话时，自动在后台完成会话接入并加载事件流；
- **新建一键发**：在「新建独立会话」状态下，用户输入 Prompt 点击「发送 Prompt ➔」，系统自动创建远端会话并投递指令，一步到位；
- **对话看板 (View Conversation)**：选中历史会话后可随时点击「💬 查看对话详情」，弹出模态抽屉查看完整的用户提问、AI 思考、工具调用与结果，并支持一键复制完整对话内容。

---

## 3. 关键接口与契约定义

### 3.1 HTTP API 路由
- `GET /v1/remote-session/projects?peerId=<id>`: 拉取对端已扫描的全部工作区工程及下属会话列表；
- `GET /v1/remote-session/models?peerId=<id>`: 拉取对端 Language Server 实时可用的排序执行模型列表；
- `GET /v1/remote-session/conversations/:id?peerId=<id>`: 提取指定会话的完整历史对话记录（Messages & Tools）；
- `POST /v1/remote-session/sessions`: 建立或接入远程协同 Session；
- `POST /v1/remote-session/sessions/:id/prompt`: 向远端会话投递 Prompt 指令；
- `POST /v1/remote-session/sessions/:id/approvals/:approvalId`: 控制端双向决策批准或拒绝操作。

---

## 4. 自动化测试与验证

自动化测试位于 `tests/unit/remote-session-*.test.mjs` 与 `tests/integration/remote-session-api.test.mjs`：
- **测试用例总数**：48 项
- **通过率**：100% (48/48 pass)
- **覆盖范围**：
  - Connect RPC 请求构建与参数校验；
  - 本地与远端 Host 挂接生命周期；
  - 事件轮询（Polling Trajectory Events）与流式推送；
  - 权限审批与会话断开恢复。
