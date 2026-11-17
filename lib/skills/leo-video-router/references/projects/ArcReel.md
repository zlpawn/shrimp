# ArcReel

仓库：https://github.com/ArcReel/ArcReel
本地代码：`/Users/pa/project/AI-JJ/ArcReel`
架构文档：`website/` (https://docs.arc-reel.com)

## 适合

- **小说/长篇故事改编成连贯漫剧或短剧**：万字文本拆集、分镜结构化、角色一致性生成。
- **角色/画风强一致性要求**：需要固定角色设计图（Asset Sheet）、四宫格/九宫格联合生图与切片。
- **需要输出剪映工程精修**：一键生成中国版剪映草稿包（ZIP），含多轨时间线（视频轨、字幕轨、旁白轨、BGM 轨、定格转场、动画关键帧）。
- **可审核、可中断恢复、成本可控**：依据摘要（Basis Digest）时效追踪引擎，修改剧本不盲目重扣费。

## 不适合

- 只要 15 秒极速生成单条信息流素材 → 交给 MoneyPrinterTurbo。
- 纯真人口播录屏剪辑、已有素材二次切片 → 交给 OpenMontage。
- 网页产品功能介绍演示片 → 交给 video-shotcraft。

## 安装

ArcReel 是一个全功能的自托管服务（FastAPI 后端 + React 前端 + 向量与数据库）：

1. **进入代码目录**：
   ```bash
   cd /Users/pa/project/AI-JJ/ArcReel
   ```
2. **启动服务（端口 1241）**：
   - 方式 A（本地 uv 启动）：
     ```bash
     uv run uvicorn server.app:app --port 1241
     ```
   - 方式 B（Docker 启动）：
     ```bash
     cd deploy && docker compose up -d
     ```
3. **配置 API Token（存储于独立文件）**：
   - 打开浏览器访问 `http://localhost:1241`；
   - 在“系统设置”页面生成或复制 API Key（以 `arc-` 开头）；
   - 执行命令直接存盘（或手动写入 `~/.shrimp/skills/leo-video-router/arcreel_token`）：
     ```bash
     uv run <本 skill 目录>/scripts/arcreel_bridge.py set-token arc-xxxx
     ```
   - 脚本会自动静默读取该文件（`~/.shrimp/skills/leo-video-router/arcreel_token`），避免将 Token 暴露在命令行历史记录中。

## 底层资产与生成引擎联动 (Asset & Engine Integration)

在 `leo-video-router` 体系中，**ArcReel 担任“编排工程（Orchestrator）”，负责剧本结构、多宫格切片、时间轴轨道编排与剪映草稿打包**；而具体的音画素材可按需调度底层的**生成引擎（Providers）**：

- **人声配音（TTS）**：
  - 遵循 Router 统一标准，推荐在 Step 5 优先调用本机 `voicestudio` / `omnivoice` 生成高质量克隆人声（落盘于 `<工程目录>/音频/旁白.wav`）；
  - 将生成的音频注入 ArcReel 项目作为正式配音轨，跳过内部第三方付费 TTS。
- **生视频算力引擎联动（RAW 镜头生产）**：
  - 当长剧集需要更高质感、极速出片或避免第三方 API 高额费用时，可调用 `leo-autodl-imagine-video`（在 AutoDL 远程 GPU 上利用 MiniMax-H3、Wan 或 Kling）批量渲染出 8K 分镜生肉（RAW `.mp4`）；
  - 将渲染镜头存入 `<工程目录>/素材/`，再由 ArcReel 挂载进对应分镜时间轴，导出带转场与音轨的剪映工程。
- **生图引擎联动**：
  - 既可利用 ArcReel 内置配置的模型执行多宫格生图；
  - 亦可由 `leo-codex-imagine` 预制好风格设计图（Asset Sheet），通过 ArcReel 资产上传通道注入，确保跨镜头绝对一致性。

## 交接与执行（Headless MCP Bridge）

Router 通过内嵌的 MCP Client 适配脚本与 ArcReel 通信，**任何 Agent 均无需在宿主环境单独配置 MCP**，直接执行终端命令即可。

### 1. 检查连通性
```bash
uv run <本 skill 目录>/scripts/arcreel_bridge.py status
```
返回 0 且 `online: true` 表示 ArcReel 服务就绪。

### 2. 查看全部可用 MCP 工具清单（大模型动态感知）
```bash
uv run <本 skill 目录>/scripts/arcreel_bridge.py tools --format markdown
```

### 3. 一键端到端漫剧流水线（推荐方式）
```bash
uv run <本 skill 目录>/scripts/arcreel_bridge.py run \
  --novel "<工程目录>/素材/小说.txt" \
  --project "地府打工记" \
  --style "anime" \
  --aspect-ratio "9:16" \
  --stage all \
  --export-jianying
```

### 4. 阶段断点控制（支持人工审核与微调）
- `--stage plan`：仅拆解分集剧本与提取主角资产，供创作者审核；
- `--stage storyboard`：生成多宫格分镜大图并自动切割为镜头；
- `--stage video`：批量推进视频渲染（自动执行 All-or-Nothing 准入并轮询）；
- `--stage export`：导出剪映草稿工程包与本地成片。

### 5. 细粒度单工具调用（大模型排查或单点重做）
```bash
# 例：只调用导出剪映工具
uv run <本 skill 目录>/scripts/arcreel_bridge.py call export_jianying_draft '{"project": "地府打工记"}'

# 例：查询所有存量项目
uv run <本 skill 目录>/scripts/arcreel_bridge.py call list_projects '{}'
```

## 音频

- **内生支持**：ArcReel 自带基于各厂商（MiniMax、CosyVoice、OpenAI）的 TTS 旁白生成与角色声音绑定。
- **与 Router 协同**：
  - 推荐优先采用 Router 本地 `voicestudio` / `omnivoice` 预先生成高质量克隆人声音频（存至 `<工程目录>/音频/旁白.wav`）；
  - ArcReel 导出剪映工程后，由 Router 的 Step 7 接管，执行统一的单行字幕校对（≤ 16 字）、双簧封面大字压制与标准归档。

## 注意

1. 批量生成视频前会触发 ArcReel 原生的 **All-or-Nothing 准入评估**（ADR 0061）。若返回 `decision: confirm`，脚本会返回预估资费，Agent 必须向创作者确认后再继续。
2. 剪映草稿导出面向中国大陆版剪映，解压后直接用剪映打开即可继续二次手工精修。
