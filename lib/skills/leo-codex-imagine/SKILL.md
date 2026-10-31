---
name: leo-codex-imagine
description: 独立调用 ChatGPT Codex 内置图片生成引擎（gpt-image-2）或任意第三方生图接口（OpenAI 协议中转、APIMart 等），支持多服务商多模型（由用户选择）、文生图、参考图生图、画面比例控制、异步任务轮询与图片自动落盘。
---

# Codex & 第三方生图通用 Skill (`leo-codex-imagine`)

完全独立运行、零外部网关强依赖的 AI 生图工具：
1. **ChatGPT Codex 订阅**：自动读取本机 `~/.codex/auth.json`，自动刷新令牌，免 API Key。
2. **第三方服务商 (providers[])**：可配置多个 Base URL，每个 Base URL 挂多个模型，由用户选择服务商和模型。

配置持久化在 `~/.shrimp/skills/leo-codex-imagine/config.json`（权限 600），Agent 可在对话中读写。

---

## 目录结构（每种接口协议一个适配器，独立维护）
```
scripts/
  leo_codex_imagine.mjs   # CLI 入口：参数解析、配置读写、服务商/模型路由、落盘
  adapters/
    http.mjs              # fetch + curl 回退、图片下载、参考图转 data URI
    codex.mjs             # Codex 订阅：令牌刷新、input_images
    openai.mjs            # 标准 OpenAI 协议：generations / edits(multipart)，比例映射为合法像素尺寸
    apimart.mjs           # APIMart：size 传比例、image_urls 参考图、task_id 异步轮询
```
新增一种协议 = 新建 `adapters/<type>.mjs`，导出 `buildPayload(auth, args, imageRefs)` 与 `generate(auth, payload)`（返回 `{ b64 }` 或 `{ url }`），再在入口 `ADAPTERS` 里注册。

---

## Agent 生图工作流（必须遵守）
不同服务商可能提供同名模型，**不要根据模型名替用户挑服务商**：
1. **用户已经说明了服务商和模型**：直接执行 `--provider <name> --model <model>`。如果这个模型还没登记在该服务商的 `models` 里，生成成功后脚本会自动登记到 config.json。
2. **用户没有说明服务商或模型**：先执行 `node <script_path> list`，把列出的服务商和模型展示给用户，让用户选好之后再执行第 1 步。
3. 只配置了一个服务商时可以省略 `--provider`；配置了多个服务商却没传 `--provider`，脚本会报错并打印可选列表（把这个列表转给用户选即可）。

## 路由规则（不读取环境变量）
1. **命令行临时指定**（最高优先级）：`--api-url` / `--api-key` [`--type`] [`--model`]。只给 `--api-url` 时会复用配置里同 URL 服务商的 Key。
2. **`--provider <name>`**：使用配置里的该服务商；`--model` 不传时取 `default_model`（属于该服务商时）或该服务商第一个模型。`--provider codex` 表示本机 Codex 订阅。
3. **Codex 本机订阅**：未配置任何服务商时兜底。

服务商 `type` 决定使用哪个适配器：`openai`（默认）或 `apimart`（`*.apimart.ai` 自动识别）。

---

## 配置格式
```json
{
  "providers": [
    {
      "name": "apimart",
      "type": "apimart",
      "api_url": "https://api.apimart.ai/v1",
      "api_key": "sk-...",
      "models": ["grok-imagine-2.0-ext", "gpt-image-2"]
    },
    {
      "name": "xinglan",
      "api_url": "https://api.xinglan.me",
      "api_key": "sk-...",
      "models": ["gpt-image-2.5-sunburst"]
    }
  ],
  "default_model": "grok-imagine-2.0-ext"
}
```
旧版扁平格式 `{ api_url, api_key, model }` 会在读取时自动迁移为一个服务商，下次 `config set` 时写回新格式。

## Agent 对话中的配置管理
```bash
# 新增/更新服务商（按 name 合并，models 取并集）
node <script_path> config set --name apimart --api-url "https://api.apimart.ai/v1" --api-key "sk-..." --models "grok-imagine-2.0-ext,gpt-image-2"
# 设置默认模型
node <script_path> config set --default-model "grok-imagine-2.0-ext"
# 删除服务商
node <script_path> config remove --name apimart
# 列出可选服务商与模型（展示给用户挑选用）
node <script_path> list
# 查看完整配置（API Key 自动脱敏，如 sk-1...7890）
node <script_path> config get
```

---

## 用法示例
```bash
S=~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs

# 先看有哪些服务商/模型
node $S list

# 文生图 + 比例（指定服务商与模型）
node $S --provider apimart --model "grok-imagine-2.0-ext" --prompt "赛博朋克风未来城市夜景，霓虹灯光" --aspect-ratio "16:9"

# 参考图生图（本地路径或 URL，可多张）
node $S --provider apimart --model "gpt-image-2" --prompt "给图中的猫咪戴上一顶海盗帽" --images "/path/to/cat.jpg,https://example.com/hat.png"

# 本机 Codex 订阅
node $S --provider codex --prompt "极简现代产品海报"

# 预检：打印路由结果与实际请求体，不扣费
node $S --provider apimart --model "grok-imagine-2.0-ext" --prompt "测试" --aspect-ratio "16:9" --dry-run
```

## 各适配器对参数的处理
| 参数 | openai | apimart | codex |
|------|--------|---------|-------|
| `--aspect-ratio` | 映射为合法像素 `size`（1024x1024 / 1536x1024 / 1024x1536，dall-e-3 为 1792 系列） | 直接作为 `size`（如 `16:9`） | `aspect_ratio` 字段 |
| `--size` | 原样传，优先于比例 | 原样传，优先于比例 | 原样传 |
| `--quality` | 默认 `medium` | 仅显式传入时发送 | 默认 `medium` |
| 参考图 | 走 `/v1/images/edits` multipart `image[]` | `image_urls`（URL 或 data URI） | `input_images` |
| 返回 | b64 / url | 异步 task_id，自动轮询 `/v1/tasks/{id}`（最长 10 分钟） | b64 / url |

> 模型能力以服务商文档为准：例如 APIMart 的 `grok-imagine-2.0-ext` 仅支持文生图（不支持参考图），比例仅支持 `1:1 2:3 3:2 3:4 4:3 9:16 16:9`。

---

## 参数完整说明
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--prompt` | 图片描述提示词（必填） | - |
| `--images` / `--image` | 参考图（本地路径或 http(s) URL），逗号分隔或多次指定 | - |
| `--aspect-ratio` | 画面比例 (例如 `16:9`, `1:1`, `9:16`, `auto`) | `auto` |
| `--size` | 图片尺寸 (例如 `1024x1024`) | 按适配器 |
| `--quality` | 画质 (`low` / `medium` / `high`) | 按适配器 |
| `--output-dir` | 图片保存目录 | `./images` |
| `--filename` | 自定义保存文件名 | 自动按语义时间戳命名 |
| `--provider` / `--name` | 服务商名称（多个服务商时必填；`codex` = 本机订阅） | 仅一个服务商时自动使用 |
| `--model` | 模型名称；成功生成后自动登记到该服务商 `models` | `default_model` 或服务商第一个模型 |
| `--type` | 服务商协议类型 `openai` / `apimart` | 按 URL 自动识别 |
| `--api-url` / `--api-key` | 临时指定端点与密钥（覆盖配置） | - |
| `--models` / `--default-model` | 仅 `config set` 使用 | - |
| `--gateway-url` / `--endpoint-id` | 可选：经网关代理生成 | - |
| `--dry-run` | 预检模式，仅打印路由结果与请求体 | `false` |
| `--help`, `-h` | 查看命令行帮助信息 | - |
