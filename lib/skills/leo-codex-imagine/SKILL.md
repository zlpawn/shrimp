---
name: leo-codex-imagine
description: 独立调用 ChatGPT Codex 内置图片生成能力（gpt-image-2），进行文生图和参考图局部编辑。完全脱离网关依赖，零配置自动读取本机 Codex 凭据并自动续期，可分发给任何用户独立运行。
---

# Codex Imagine Skill (ChatGPT Codex 独立图片生成)

本技能是一个**完全独立运行、零外部服务依赖**的 AI 图片生成工具，可直接调用 ChatGPT Codex 订阅的图像生成引擎（`gpt-image-2`）。

无需运行本地网关，脚本自带凭据解析、自动令牌刷新、高可用网络请求与媒体落盘管理，可直接分发给任何未安装网关的用户使用。

## 核心特性
- ✅ **100% 独立运行**：完全脱离本地网关（Gateway）与第三方服务，直连官方端点。
- ✅ **零配置自动鉴权**：自动读取本机 `~/.codex/auth.json` 中的 ChatGPT 订阅凭据。
- ✅ **智能令牌保活**：内置 JWT 校验，当 Access Token 过期时自动向 OpenAI 认证服务器请求换新并持久化保存。
- ✅ **双通道高可用**：采用 Node.js 原生 fetch + 系统 curl 自动回退，完美兼容代理与各类复杂网络环境。
- ✅ **丰富生图能力**：支持基础文生图、单/多张参考图局部修改（Image Edit）、画面比例与尺寸画质控制。
- ✅ **多模式兼容**：未登录 Codex 时亦可无缝退守至标准 `OPENAI_API_KEY`（DALL-E-3）。

## 使用场景
当用户表达以下意图时触发：
- "用 Codex 画一张图" / "用 ChatGPT 生成图片" / "用 Codex 生成一张..."
- "基于这张图修改" / "参考这张图生成"
- "/codex_imagine"

## 依赖与前提条件
1. **运行环境**：Node.js 18+（无需执行 `npm install`，纯原生标准库）。
2. **账号凭证（二选一）**：
   - **Codex 订阅（首选）**：只要本机运行过 `codex` 登录账号（存在 `~/.codex/auth.json`），脚本即可全自动读取并维护鉴权。
   - **API Key（备选）**：如果未登录 Codex，可通过环境变量 `OPENAI_API_KEY` 或命令行 `--api-key` 传入标准密钥。
3. **网络**：需可正常连接 OpenAI / ChatGPT 官方服务（若在受限网络环境，系统环境变量 `https_proxy` / `http_proxy` 会被自动继承）。

## 脚本调度路径
- Antigravity: `node ~/.gemini/config/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs`
- Claude: `node ~/.claude/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs`
- Codex: `node ~/.codex/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs`
- 中央库: `node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs`
- 项目相对路径: `node ./scripts/leo_codex_imagine.mjs`

## 命令行参数与用法示例

### 1. 文生图 (Text to Image)
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "赛博朋克风的未来城市夜景，霓虹灯光" --aspect-ratio "16:9"
```

### 2. 参考图编辑 / 图生图 (Image Edit)
传入单张或多张本地图片路径（逗号分隔）：
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "给图中的猫咪戴上一顶海盗帽" --images "/path/to/cat.jpg"
```

### 3. 指定尺寸与质量
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "高清产品概念图" --size "1024x1024" --quality high
```

### 4. 预检模式 (--dry-run)
校验本机凭证状态与参数拼装，不实际发起 API 扣费调用：
```bash
node ~/.agents/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs --prompt "测试" --dry-run
```

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
| `--api-key` | 备用 OpenAI API 密钥（留空则默认读 Codex 订阅） | `env:OPENAI_API_KEY` |
| `--gateway-url` | 可选：若需转发到特定网关代理时使用 | - |
| `--dry-run` | 预检模式，仅打印 Payload 不实际生成 | `false` |
| `--help`, `-h` | 查看命令行帮助信息 | - |

## 输出目录与文件命名
- 默认存储在当前执行目录下的 `./images/` 文件夹中。
- 文件名格式：`codex_<提示词缩写>_<YYYYMMDDHHmmss>.png`
- 成功后自动输出标准 Markdown 预览格式：`![Generated Image](filePath)`
