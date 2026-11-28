# `leo-antigravity-chat` 独立问答 Skill 设计方案

> 日期：2026-11-26  
> 目标目录：`lib/skills/leo-antigravity-chat/`

## 1. 设计目标与硬约束

1. **彻底独立（零网关、零第三方 npm 依赖）**：
   - 仅使用 Node.js 24 原生内置模块（`node:http2`、`node:tls`、`node:net`、`node:http`、`node:https`、`node:fs`、`node:os`、`node:path`、`node:crypto`、`node:zlib`、`node:child_process`、`node:url`）。
   - 不依赖 `local-ai-gateway` 进程、不依赖 `server.js`、不读取 `gateway.config.json`。
2. **凭据严格隔离**：
   - 配置与 OAuth 密钥统一且**仅**保存在 `~/.shrimp/skills/leo-antigravity-chat/config.json`（文件权限 `0600`，原子写入；支持环境变量 `LEO_ANTIGRAVITY_CHAT_CONFIG_PATH` 覆盖）。
   - **禁止**在运行时或配置导入默认路径中自动读取 `~/.shrimp/skills/leo-antigravity-imagine/config.json`、`~/.shrimp/antigravity.secrets.json` 或当前目录 `antigravity.secrets.json`。
   - 运行问答 / 查询模型 / 查询额度时，如果缺少 `client_id`/`client_secret`/`refresh_token`，只明确报错并提示用户执行 `login` 或 `config import --from <path>` / `config set`，**不自动弹窗**也不在问答链路中隐式扫描桌面端。
3. **显式初始化与自动续期**：
   - `login` 子命令：用户主动触发时，从本机 `Antigravity.app` 提取公共 `client_id` / `client_secret`（或使用已手动配置的凭据），在 `127.0.0.1:18789/callback` 拉起临时回调服务并引导浏览器完成 Google OAuth2 授权，落盘到 `config.json`。
   - `config import --from <path>` 与 `config set`：支持显式导入用户指定的密钥 JSON 或手工设置字段。
   - `ensureFreshAuth`：调用上游前检测 `config.json` 内 `access_token` 是否缺失或距 `expires_at` 不足 900 秒；若是则自动用同文件中的 `refresh_token` 刷新并原子写回 `config.json`。

## 2. 模块划分

```text
lib/skills/leo-antigravity-chat/
├── SKILL.md
├── package.json
└── scripts/
    ├── leo_antigravity_chat.mjs   # CLI 入口（ask / list / quota / login / config / session）
    └── lib/
        ├── config.mjs             # 独立 config.json 读写、0600 原子落盘、显式 import、脱敏
        ├── proxy.mjs              # 四级代理探测 + HTTP CONNECT / SOCKS5 TLS(ALPN h2) + 图片读取
        ├── oauth.mjs              # 显式 login + 基于自身 refresh_token 的自动续期
        ├── proto.mjs              # 零依赖 v1internal GenerateContent & Quota Protobuf 编解码
        ├── client.mjs             # loadCodeAssist / fetchRemoteModels / gRPC 流式问答 / quota
        └── session.mjs            # ~/.shrimp/skills/leo-antigravity-chat/sessions/ 多轮会话存储
```

## 3. CLI 接口与 Agent 集成契约

- **默认问答**：
  ```bash
  node <skillDir>/scripts/leo_antigravity_chat.mjs \
    --prompt "问题" \
    [--model gemini-3.8-flash-high] \
    [--system "系统提示词" | --system-file path] \
    [--images a.png,b.jpg] \
    [--session my-session] \
    [--temperature 0.7] [--max-tokens 4096] [--thinking-budget 1024] \
    [--show-thinking] [--stream] [--json] \
    [--proxy http://127.0.0.1:7897 | --no-proxy] [--dry-run]
  ```
  - 支持 `--prompt -` 或无 `--prompt` 时自动从管道 `stdin` 读取输入，方便其他 Agent 传入长文本/代码。
  - 默认直接向 `stdout` 输出纯文本答案；加 `--stream` 实时流式输出增量文本；加 `--json` 输出结构化 JSON（`{ ok, model, session_id, text, thinking, finish_reason, usage, remaining_credits }`），方便 Agent 编程解析。
- **模型列表与同步**：`list [--remote] [--sync] [--json]`
- **额度查询**：`quota [--json]`
- **OAuth 登录**：`login [--port 18789] [--no-browser]`
- **配置管理**：`config get` / `config set ...` / `config import --from <path>`
- **会话管理**：`session list` / `session show <id>` / `session clear [id]`

## 4. 测试与验证计划

在 `tests/unit/leo-antigravity-chat-skill.test.mjs` 中以零外网依赖（本地 mock HTTP / HTTP2 h2c 服务）全面验证：
1. 配置隔离性：默认路径、不回退读取外部 secrets、`importSecretsFromFile` 必须传显式路径、`0600` 权限、模型注册。
2. 代理四级优先级与图片部分读取。
3. Protobuf 编解码：文本、`thought`、`thinkingConfig`、`temperature`/`topP`/`maxOutputTokens`、`inlineData`、`usageMetadata`、`finishReason`。
4. OAuth 自动续期与缺少凭据时拒绝自动弹窗的报错提示。
5. 多轮会话持久化（`session.mjs`）与端到端 mock gRPC 问答（含单轮、多轮、`--json`、流式输出、额度查询）。
