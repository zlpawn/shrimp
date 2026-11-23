---
name: leo-antigravity-video
description: 驱动 Google Antigravity / Gemini Veo 引擎进行 AI 视频生成、画面比例与格式控制、视频直链抓取与本地媒体资产自动化归档落盘。当用户提到 Gemini 生视频、Veo 视频生成、下载 Gemini 视频或 leo-antigravity-video 时使用。
---

# Google Antigravity / Gemini Veo 视频生成与归档 Skill (`leo-antigravity-video`)

完全脱离外部付费网关、借助本机 Chrome 原生 CDP 调试通道直接驱动 Google Gemini（Veo / Gemini Omni 引擎）的自动化视频生成与全资产归档工具。

## 核心设计与前置原则

1. **零固定写死目录（Zero Hardcoded Paths）**：
   - 技能内部绝对不硬编码个人用户路径。所有路径均由 `os.homedir()`、CLI 参数 `--out`、环境变量（如 `LEO_ANTIGRAVITY_VIDEO_OUT`）或动态发现机制驱动。
2. **依赖协同与大模型动态引导（Agent Dynamic Discovery）**：
   - 本技能底层通过 CDP 通道操控真实浏览器，**依赖 `leo-lantern` 技能**。
   - **大模型调度指引**：大模型在调用或排查本技能时，若未在全局 PATH 中找到 `leo-lantern`，**严禁使用写死的绝对路径**，而应主动引导自身去用户技能目录中检索已安装的 `leo-lantern`（读取 `leo-lantern/SKILL.md` 获取入口），或通过环境变量 `LEO_LANTERN_CLI` 动态注入。
3. **零登录负担（Zero-Login）**：
   - 自动接管本机 Chrome 中已登录的 Google 账号（包括 Google One Pro / Ultra 会员），100% 免疫网络风控与人机验证。
4. **多画面比例与格式控制**：
   - 支持横向 `16:9`、纵向短视频 `9:16`，支持导出标准 `MP4` 视频及 `GIF` 动图。
5. **标准化素材归档（Ground Truth Archiving）**：
   - 默认存储于 `~/素材/gemini-videos/<YYYY-MM-DD>/<主题>_<比例>_<时间戳>/`。
   - 自动生成：`video.mp4`（720P 原片）、`cover.jpg`（ffmpeg 抽取封面）、`metadata.json`（提示词、时长、码率、直链存证）。

---

## 目录结构

```text
leo-antigravity-video/
├── SKILL.md
├── package.json
└── scripts/
    ├── cli.mjs                  # 命令行入口 (leo-antigravity-video)
    └── lib/
        ├── config.mjs           # 配置持久化与无硬编码路径解析
        ├── lantern-driver.mjs   # 动态嗅探 leo-lantern 并驱动 Gemini Web
        └── archiver.mjs         # 资产目录规划、ffprobe 元数据探测与 ffmpeg 抽帧
```

---

## 快速上手与 CLI 命令

已注册全局软链，可在终端任意路径直接执行 `leo-antigravity-video`（或 `node <skillDir>/scripts/cli.mjs`）。

### 1. 文生视频并全自动归档（标准 16:9）
```bash
leo-antigravity-video --prompt "两只机械赛博猫在霓虹街道上跑酷" --ratio 16:9
```

### 2. 生成竖屏短视频（9:16，适合小红书/抖音/Reels）
```bash
leo-antigravity-video --prompt "雨滴落在荷叶上的微距特写，电影质感慢动作" --ratio 9:16
```

### 3. 仅下载并归档当前 Gemini 标签页中已生成的视频
无需重新生成，直接提取当前会话中的视频资产：
```bash
leo-antigravity-video --download-only
```

### 4. 自定义归档输出路径
```bash
leo-antigravity-video --prompt "极光掠过雪山" --out ~/素材/custom-videos/
```

### 5. 查看与修改默认配置
```bash
# 查看当前配置
leo-antigravity-video config get

# 修改默认输出目录或默认比例
leo-antigravity-video config set --output-dir "~/素材/gemini-videos" --default-ratio "16:9"
```

---

## 参数说明

| 参数 | 简写 | 说明 | 默认值 |
| :--- | :--- | :--- | :--- |
| `--prompt` | `-p` | 视频生成提示词（必填，`--download-only` 时可选） | - |
| `--ratio` | `-r` | 画面比例：`16:9`（横向）或 `9:16`（纵向） | `16:9` |
| `--thinking` | `-k` | 大模型思考等级：`high`（高/超级详尽）、`mid`（中）、`low`（低） | `high` |
| `--format` | `-f` | 导出格式：`mp4` 或 `gif` | `mp4` |
| `--out` | `-o` | 资产归档基础目录（支持环境变量 `LEO_ANTIGRAVITY_VIDEO_OUT` 覆盖） | `~/素材/gemini-videos` |
| `--download-only`| `-d` | 不发起新生成，仅下载归档当前标签页中的最新视频 | `false` |
| `--timeout` | `-t` | 最大等待云端渲染时间（秒） | `180` |
| `--help` | `-h` | 查看帮助文档 | - |

---

## 提示词避坑指南 (Prompt Engineering for Veo)

> [!WARNING]
> **商业影视版权与名人人名规避**：
> Google Gemini / Veo 具备极严格的版权与公众人物安全审查机制。若提示词中直接出现商业电影名称（如《叶问》、《复仇者联盟》）或真人演员名字，Veo 会拒绝视频渲染，并自动回退为纯文本回复（“我的设计用途只是处理和生成文本...”）。
> **推荐写法**：将其解构为**具体的视觉与动作特征描写**。例如将“模仿电影《叶问》”改写为“黑白奶牛猫幼猫摆出传统咏春拳问手架势，小爪子在木人桩前快速打出连环日字冲拳，古典武馆木地板光影特写”。

---

## 资产归档规范

每个视频任务均会以独立文件夹沉淀，结构如下：
```text
~/素材/gemini-videos/
└── 2026-11-24/
    └── 黑白奶牛猫打咏春拳_16x9_20261124_001830/
        ├── video.mp4          # 1280x720 24fps 原片（含 AAC 立体声）
        ├── cover.jpg          # 封面缩略图（默认截取第 2 秒）
        └── metadata.json      # 结构化存证（Prompt、分辨率、时长、Google CDN 直链等）
```
