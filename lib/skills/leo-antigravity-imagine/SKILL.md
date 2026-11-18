---
name: leo-antigravity-imagine
description: 独立直连 Google Antigravity 官方订阅生图引擎（默认 gemini-3.1-flash-image，支持扩展旗舰模型），零网关依赖，内置 OAuth 登录/自动刷新、本机代理自动继承、文生图、多参考图生图、画面比例与 1K/2K/4K 分辨率控制及自动落盘。
---

# Antigravity 独立生图 Skill (`leo-antigravity-imagine`)

完全脱离外部网关、仅依赖 Node.js 原生模块独立运行的 Google Antigravity 订阅图片生成工具：
1. **单文件配置与凭据持久化**：模型列表（`models` / `default_model`）与 Antigravity OAuth 密钥统一保存在 `~/.shrimp/skills/leo-antigravity-imagine/config.json`（权限 `0600`），令牌过期前自动刷新并原子写回。
2. **本机代理自动继承**：按 `--proxy` / `--no-proxy` → `config.json` 的 `proxy` → 环境变量 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` → 系统代理（macOS `scutil --proxy` / Windows 注册表）自动探测，通过原生 `HTTP CONNECT` / `SOCKS5` + TLS (`ALPN h2`) 穿透全链路。
3. **原生 HTTP/2 gRPC + `ImageConfig` 控制**：直连 `v1internal` `PredictionService/GenerateContent`，原生编码 `responseModalities=[IMAGE]` 与 `ImageConfig`（`aspect_ratio` + `image_size`），支持本地文件或 URL 参考图并自动嗅探图片格式落盘。

---

## 目录结构
```text
scripts/
  leo_antigravity_imagine.mjs   # CLI 入口：生图、list、login、config get/set/import、落盘
  lib/
    config.mjs                  # ~/.shrimp/skills/leo-antigravity-imagine/config.json (0600) 读写、脱敏与导入
    proxy.mjs                   # 四级本机代理自动探测 + 原生 HTTP CONNECT / SOCKS5 TLS 隧道 + 参考图加载
    oauth.mjs                   # 本机 Antigravity.app 客户端凭据自动提取 + 浏览器 OAuth 登录 + Token 自动刷新
    proto.mjs                   # 零依赖 GenerateContent Protobuf 编解码（含 ImageConfig）
    client.mjs                  # loadCodeAssist 项目解析缓存 + fetchAvailableModels + HTTP/2 gRPC 生图流
```

---

## 配置文件结构 (`~/.shrimp/skills/leo-antigravity-imagine/config.json`)
```json
{
  "default_model": "gemini-3.1-flash-image",
  "models": [
    "gemini-3.1-flash-image"
  ],
  "proxy": "",
  "auth": {
    "client_id": "<your-client-id>.apps.googleusercontent.com",
    "client_secret": "<your-client-secret>",
    "access_token": "<your-access-token>",
    "refresh_token": "<your-refresh-token>",
    "expires_at": 1795000000,
    "account_id": "user@example.com",
    "project": "cloudaicompanion-project-id"
  }
}
```

---

## 快速初始化与配置管理

将 `<skillDir>` 解析为本 Skill 的实际安装根目录：
```bash
S=<skillDir>/scripts/leo_antigravity_imagine.mjs
```

### 1. 首次写入凭据（二选一）
```bash
# 方式 A：直接本机浏览器 OAuth 授权登录（自动从本机 Antigravity.app 提取 client_id / client_secret）
node $S login

# 方式 B：从已有的 antigravity.secrets.json 一键导入凭据
node $S config import --from /path/to/antigravity.secrets.json
```

### 2. 查看与调整模型 / 配置
```bash
# 查看本地已登记模型、登录状态与生效代理
node $S list

# 在线查询 Google Antigravity 订阅当前开放的生图模型（加 --sync 自动合并进 config.json）
node $S list --remote --sync

# 查看完整配置（所有密钥自动脱敏展示）
node $S config get

# 设置默认模型、追加模型列表或固定代理
node $S config set --default-model "gemini-3.1-flash-image" --models "gemini-3.1-flash-image"
```

---

## 生图用法示例

> **Agent 归档与命名强制规约（对齐 `leo-imagine-router`）**：
> 调用本 Skill 出图时，优先提炼并传入 `--cat "<场景大类>" --topic "<精炼主题>" --style "<细分风格>"`（八大标准分类：`海报艺术` / `拆解图鉴` / `商业包装` / `视觉信息图` / `古代书画` / `影视分镜` / `脑洞跨界` / `通用出图`），自动归档为：
> `<output_dir>/<场景大类>/<YYYY-MM-DD>/<主题>_<细分风格>_<YYYYMMDD_HHmmss>.<ext>`
> （例如：`~/素材/imagine/影视分镜/2026-11-18/末日废土雨夜求生_12格电影感短剧分镜_20261118_144557.jpg`）。若由 `leo-imagine-router` 上游已计算好路径，直接传入 `--output-dir "<targetDir>" --filename "<filename>"` 即可。

### 1. 文生图 + 场景分层归档 + 高清档位
```bash
node $S --prompt "赛博朋克风的未来城市夜景，霓虹倒影" --cat "海报艺术" --topic "未来都市夜景" --style "赛博朋克霓虹海报" --aspect-ratio "16:9" --image-size "2K"
```

### 2. 参考图生图（支持本地路径或 URL，多张逗号分隔）
```bash
node $S --prompt "保持人物面部特征，转换为清透水彩插画风格" --cat "通用出图" --topic "人物肖像" --style "清透水彩插画" --images "/path/face.jpg,/path/style.png" --aspect-ratio "3:4"
```

### 3. 预检模式 (`--dry-run`)
```bash
node $S --prompt "末日废土雨夜求生" --cat "影视分镜" --topic "末日废土雨夜求生" --style "12格电影感短剧分镜" --aspect-ratio "16:9" --dry-run
```

---

## 参数说明
| 参数 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `--prompt` | 图片描述提示词（必填） | - |
| `--images` / `--image` | 参考图路径或 `http(s)` URL，逗号分隔或重复传入 | - |
| `--model` | 指定生图模型（成功后新模型自动登记到 `config.json`） | `default_model` (`gemini-3.1-flash-image`) |
| `--aspect-ratio` | 画面比例 (`1:1` / `2:3` / `3:2` / `3:4` / `4:3` / `9:16` / `16:9` / `21:9` 等) | `auto` |
| `--image-size` / `--size` | 分辨率档位 (`512` / `1K` / `2K` / `4K`，大小写不敏感) | 模型默认 (`1K`) |
| `--quality` | 画质档位别名，对齐 `leo-codex-imagine` (`low`→`1K` / `medium`→`2K` / `high`→`4K`) | - |
| `--category` / `--cat` | 场景归档大类（`海报艺术` / `拆解图鉴` / `商业包装` / `视觉信息图` / `古代书画` / `影视分镜` / `脑洞跨界` / `通用出图`） | `通用出图` |
| `--topic` | 精炼主题词（用于拼接 `<主题>_<细分风格>_<时间戳>.<ext>`） | 自动从 Prompt 提炼短词 |
| `--style` | 细分风格词 | 自动从 Prompt 提炼短词 |
| `--output-dir` | 输出目录（未传时自动解析为 `<Router配置或./images>/<场景大类>/<YYYY-MM-DD>/`） | `<baseDir>/<场景大类>/<YYYY-MM-DD>/` |
| `--filename` | 自定义文件名（兼容别名 `--image-name`） | `<主题>_<细分风格>_<YYYYMMDD_HHmmss>.<ext>` |
| `--proxy` / `--no-proxy` | 临时覆盖代理 URL，或强制本次直连 | 自动继承本机代理 |
| `--dry-run` | 预检模式，打印配置、代理与请求结构，不实际调用接口 | `false` |

## Agent 回传规则
脚本成功后会打印如下标准 Markdown 图片链接，Agent 必须将其原样包含在回复中：
```markdown
![Generated Image](/absolute/path/to/image.png)
```

## 异常处理指引
- **未登录 / 缺少凭据**：引导用户运行 `node $S login` 完成浏览器授权，或通过 `node $S config import --from <path>` 导入已有密钥。
- **`RESOURCE_EXHAUSTED` (status=8)**：提示用户当前订阅生图配额或 Google 云端算力繁忙，稍后重试。
- **`NOT_FOUND` (status=5)**：提示该模型尚未在当前 Antigravity 订阅开放，可通过 `node $S list --remote` 查看当前可用模型。
