---
name: leo-codex-imagine
description: 独立调用 ChatGPT Codex 内置图片生成引擎（gpt-image-2）或任意兼容 OpenAI 协议的第三方生图接口（DALL-E-3、Flux、Midjourney 中转等），支持文生图、参考图局部编辑、URL/Base64 自动落盘与持久化配置。
---

# Codex & OpenAI 协议通用生图 Skill (`leo-codex-imagine`)

本技能是一个**完全独立运行、零外部网关强依赖**的通用 AI 图像生成工具。它具备双核心驱动引擎：
1. **ChatGPT Codex 订阅引擎**：自动读取本机 `~/.codex/auth.json`，零配置自动保活，免 API Key 消耗订阅额度；
2. **OpenAI 协议通用引擎**：支持自定义 API URL 与 API Key（支持 OneAPI、NewAPI、各类聚合中转站、自建 SD/Flux 代理网关），支持自由指定 `--model`。

配置可由 Agent 在对话中持久化保存在 `~/.shrimp/skills/leo-codex-imagine/config.json`，日常使用零摩擦。

---

## 核心特性
- ✅ **双模式无缝切换**：优先使用自定义 API 配置（中转站/第三方），未配置时自动无感退守至本机 Codex 订阅（免 Key 运行）。
- ✅ **Agent-Native 配置持久化**：配置集中在 `~/.shrimp/skills/leo-codex-imagine/config.json`，支持 Agent 在对话中自动读写。
- ✅ **自定义 URL 与模型**：支持 `--api-url`（自动规范化补齐 `/v1/images/generations`）与 `--model`（如 `dall-e-3`, `flux-pro`, `gpt-image-2`）。
- ✅ **双格式文件自动落盘**：无论是 `b64_json` 还是远程图片 `url`，均自动完成本地下载与磁盘落盘，确保返回有效本地图片路径。
- ✅ **双通道高可用**：采用 Node.js 原生 fetch + 系统 curl 自动回退，抵抗受限网络环境。

---

## 鉴权与端点解析阶梯（三级优先级，不检查环境变量）
1. **命令行参数**（最高优先级，单次覆盖）：`--api-key`、`--api-url`、`--model`
2. **Shrimp 持久化配置**（Agent 在对话中读写）：`~/.shrimp/skills/leo-codex-imagine/config.json`
3. **Codex 本机订阅凭证**（官方免 Key 兜底）：`~/.codex/auth.json`（自动保活 JWT）

---

## Agent 对话中的配置管理指南 (Agent Operations)

当用户在对话中提供 API Key、中转地址或要求设置默认模型时，Agent 应通过 CLI 命令或直接操作 JSON 文件写入配置：

### 1. 写入/更新配置
```bash
node <script_path> config set --api-url "https://api.example.com" --api-key "sk-..." --model "flux-pro"
```
或直接写入 `~/.shrimp/skills/leo-codex-imagine/config.json`：
```json
{
  "api_url": "https://api.example.com",
  "api_key": "sk-...",
  "model": "flux-pro"
}
```

### 2. 读取/查询当前配置
```bash
node <script_path> config get
```
返回中 API Key 自动脱敏，如 `sk-12***7890`。

---

## 命令行参数与用法示例

### 1. 基础文生图 (Text to Image)
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "赛博朋克风未来城市夜景，霓虹灯光" --aspect-ratio "16:9"
```

### 2. 使用特定模型与自定义 API
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "极简现代产品海报" --api-url "https://my-oneapi.com" --api-key "sk-xxx" --model "flux-pro"
```

### 3. 参考图局部编辑 (Image Edit)
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "给图中的猫咪戴上一顶海盗帽" --images "/path/to/cat.jpg"
```

### 4. 预检模式 (--dry-run)
校验解析出的模式、目标端点与模型，不实际发起网络扣费：
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "测试" --dry-run
```

---

## 参数完整说明
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--prompt` | 图片描述提示词（必填） | - |
| `--images` / `--image` | 参考图本地路径，逗号分隔多张或多次指定 | - |
| `--aspect-ratio` | 画面比例 (例如 `16:9`, `1:1`, `9:16`, `auto`) | `auto` |
| `--size` | 图片尺寸 (例如 `1024x1024`, `auto`) | `auto` |
| `--quality` | 画质 (`low` / `medium` / `high`) | `medium` |
| `--output-dir` | 图片保存目录 | `./images` |
| `--filename` | 自定义保存文件名 | 自动按语义时间戳命名 |
| `--api-url` | 自定义 OpenAI 兼容端点 URL（自动补齐 `/v1/images/generations`） | 读 `config.json` 或官方端点 |
| `--api-key` | 自定义 API 密钥（优先级高于 `config.json` 与 Codex 订阅） | 读 `config.json` 或 Codex 凭证 |
| `--model` | 指定模型名称（如 `dall-e-3`, `flux-pro`, `gpt-image-2`） | 读 `config.json` 或模式默认 |
| `--gateway-url` | 可选：网关代理 URL | - |
| `--dry-run` | 预检模式，仅打印解析结果不实际发起请求 | `false` |
| `--help`, `-h` | 查看命令行帮助信息 | - |
