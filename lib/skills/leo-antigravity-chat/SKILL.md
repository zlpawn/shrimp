---
name: leo-antigravity-chat
description: 独立直连 Google Antigravity 订阅大模型进行文本与多模态问答的 CLI Skill，零网关与第三方依赖，凭据严格隔离在 ~/.shrimp/skills/leo-antigravity-chat/config.json，支持自动刷新 token、多轮会话、图片输入与配额查询。
---

# Antigravity 独立问答 Skill (`leo-antigravity-chat`)

完全脱离 `local-ai-gateway` 网关、仅依赖 Node.js 原生内置模块直连 Google Antigravity 上游的问答工具，供其他 AI Agent 或终端直接调用：
1. **严格凭据隔离**：配置与 OAuth 密钥**仅**保存于 `~/.shrimp/skills/leo-antigravity-chat/config.json`（权限 `0600`），不读取网关或其他 Skill 的密钥文件；`access_token` 临近过期时自动用同一文件中的 `refresh_token` 刷新并原子写回。
2. **本机代理自动继承**：按 `--proxy` / `--no-proxy` → `config.json` 的 `proxy` → 环境变量 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` → 系统代理（macOS `scutil --proxy` / Windows 注册表）自动穿透。
3. **支持多模型与多轮对话**：支持 `gemini-3.8-flash-high`、`gemini-4-hydrogen-sonar`、`claude-sonnet-5-5-high`、`claude-opus-5-5-high` 等 Antigravity 订阅模型，支持 `--session` 持久化多轮上下文、`-i/--images` 看图问答、`--stream` 流式输出与 `--json` 结构化输出。

---

## 目录结构
```text
scripts/
  leo_antigravity_chat.mjs   # CLI 入口：ask / list / quota / login / config / session
  lib/
    config.mjs               # ~/.shrimp/skills/leo-antigravity-chat/config.json (0600) 读写与显式导入
    proxy.mjs                # 四级代理探测 + 原生 HTTP CONNECT / SOCKS5 TLS (ALPN h2) + 图片读取
    oauth.mjs                # 显式 login 浏览器授权 + 同文件 refresh_token 自动续期
    proto.mjs                # 零依赖 v1internal GenerateContent & Quota Protobuf 编解码
    client.mjs               # loadCodeAssist / fetchAvailableModels / HTTP/2 gRPC 问答 / quota
    session.mjs              # ~/.shrimp/skills/leo-antigravity-chat/sessions/ 多轮会话存储
```

---

## 首次初始化（二选一）

将 `<skillDir>` 解析为本 Skill 的实际安装根目录：
```bash
S=<skillDir>/scripts/leo_antigravity_chat.mjs
```

```bash
# 方式 A：显式运行 login，打开浏览器完成一次 Google OAuth 授权（从本机 Antigravity.app 提取客户端标识）
node $S login

# 方式 B：显式导入已有的密钥 JSON 文件到 ~/.shrimp/skills/leo-antigravity-chat/config.json
node $S config import --from /path/to/secrets.json
```

---

## Agent 常用调用方式

### 1. 单次问答（默认输出纯文本，支持管道输入）
```bash
node $S --prompt "用三句话总结 HTTP/2 多路复用的原理" --model gemini-3.8-flash-high

# 通过 stdin 传入长代码或文档
cat path/to/file.js | node $S --prompt - --system "请做代码安全审查并指出潜在 Bug"
```

### 2. 结构化 JSON 输出（推荐 Agent 解析使用）
```bash
node $S --prompt "给出 3 个优化思路" --json
```
返回格式：
```json
{
  "ok": true,
  "model": "gemini-3.8-flash-high",
  "model_version": "...",
  "session_id": null,
  "text": "...",
  "finish_reason": "STOP",
  "usage": { "input_tokens": 82, "output_tokens": 120, "total_tokens": 202 }
}
```

### 3. 多轮连续对话 (`--session`)
```bash
node $S --session review-1 --prompt "先看下这个架构方案有什么瓶颈..."
node $S --session review-1 --prompt "针对第 2 点给出具体改造步骤"
```

### 4. 看图 / 多模态问答 (`--image` / `--images`)
```bash
node $S --prompt "解释这张架构图中的数据流向" --images "/abs/path/arch.png"
```

### 5. 模型列表、配额与会话管理
```bash
# 查看本地与远端可用模型（--sync 同步进 config.json）
node $S list --remote --sync

# 查询当前订阅剩余额度
node $S quota

# 查看 / 清理多轮会话
node $S session list
node $S session clear review-1
```

---

## 异常处理指引
- **缺少凭据 / 未登录**：提示用户显式执行 `node $S login` 完成浏览器授权，或执行 `node $S config import --from <path>` 导入凭据到 `~/.shrimp/skills/leo-antigravity-chat/config.json`。
- **`NOT_FOUND` (status=5)**：模型名称不存在或当前订阅未开放，先运行 `node $S list --remote` 查看准确模型 ID。
- **`RESOURCE_EXHAUSTED` (status=8)**：配额耗尽或上游限流，可通过 `node $S quota` 查看剩余额度与重置时间。
