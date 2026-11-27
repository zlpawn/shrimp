---
name: leo-flow-video
description: 驱动 Google Flow (flow.google.com / Veo 视频工作台) 引擎进行 AI 视频生成、画幅与画质控制、单批次点数优化、渲染进度监听与本地媒体资产标准化归档。当用户提到 Google Flow、Flow 视频生成、flow.google.com、Veo 视频生成、下载 Flow 视频或使用 /leo-flow-video 时使用。
---

# Google Flow AI 视频生成与归档 Skill (`leo-flow-video`)

完全脱离外部付费网关、借助本机 Chrome 原生 CDP 通道直接驱动 Google 官方 AI 创意工作室与 Veo 视频工作台（`flow.google.com`）的自动化视频生成与全资产归档工具。

## 核心设计与特性

1. **真实会话与免登录负担（Zero-Login）**：
   - 自动接管本机 Chrome 中已登录的 Google 账号（包括 Google One Pro 会员），100% 免疫人机验证；
   - 自动探测并复用当前标签页已打开的项目或指定项目 ID。
2. **精准省点数控制（Cost Optimization）**：
   - 自动在参数抽屉中将默认批次从 `x2`（消耗 120 点）强制纠偏为 **`x1`（单次消耗仅 60 点）**，点数消耗直降 50%。
3. **穿透 ProseMirror 编辑器注入**：
   - 无损穿透富文本输入框注入多行提示词，派发原生可信 InputEvent 激活底层 Angular 状态机与提交按钮。
4. **规范中文子目录结构（对齐抖音/短视频项目工程规范）**：
   - 默认存储于 `~/google-flow/YYYY-MM-DD-flow_<提示词简写>/`；
   - 采用纯中文标准化分级子目录：`成片/原始版`、`成片/发布版`、`成片/封面`、`素材/视频分镜`、`音频`、`字幕`；
   - 规范沉淀 `脚本.md`、`交付记录.md`（含 B站/抖音/小红书 3-Pick 分发战术矩阵）以及 `生成事实.json`；
   - **纯净落盘**：无任何多余状态图/审核截图干扰。
5. **动态目录记忆与零硬编码路径**：
   - 默认存储于 `~/google-flow`（动态解析至用户主目录下的 `google-flow`），支持 CLI `--out` 动态指定并自动持久化记忆到 `~/.shrimp/skills/leo-flow-video/config.json`。
6. **提供 `--dry-run` 预览截停**：
   - 支持前置配置参数、注入提示词并核对后自动截停，**不扣除任何点数**。

---

## 目录结构

```text
leo-flow-video/
├── SKILL.md
├── package.json
└── scripts/
    ├── cli.mjs                  # 命令行入口 (leo-flow-video)
    └── lib/
        ├── config.mjs           # 配置持久化与路径解析 (~/.shrimp/skills/leo-flow-video/config.json)
        ├── flow-driver.mjs      # 动态嗅探 leo-lantern 并驱动 Google Flow
        └── archiver.mjs         # 规范工程目录规划与交付记录沉淀
```

---

## 快速上手与 CLI 命令

将 `<skillDir>` 解析为本 Skill 安装根目录，直接通过 Node.js 执行：`node <skillDir>/scripts/cli.mjs`。

### 1. 文生视频并全自动归档（标准 16:9，默认 720p，单批次 x1）
```bash
node <skillDir>/scripts/cli.mjs --prompt "两只机械赛博猫在霓虹街道上跑酷，4k电影质感"
```

### 2. 生成竖屏短视频（9:16，适合小红书/抖音/Reels）
```bash
node <skillDir>/scripts/cli.mjs --prompt "雨滴落在荷叶上的微距特写，电影质感慢动作" --ratio 9:16
```

### 3. 自定义归档根目录（会自动记忆）
```bash
node <skillDir>/scripts/cli.mjs --prompt "极光掠过雪山" --out ~/google-flow
```

### 4. 预览核对模式（配置参数并填入提示词，不扣点数）
```bash
node <skillDir>/scripts/cli.mjs --prompt "太空飞船穿过星云" --dry-run
```

### 5. 查看与修改默认配置
```bash
# 查看当前配置
node <skillDir>/scripts/cli.mjs config get

# 修改默认输出目录或默认清晰度
node <skillDir>/scripts/cli.mjs config set --output-dir "~/google-flow" --default-resolution "720p"
```

---

## 参数说明

| 参数 | 简写 | 说明 | 默认值 |
| :--- | :--- | :--- | :--- |
| `--prompt` | `-p` | 视频生成提示词（必填） | - |
| `--prompt-file`| `-f` | 从外部文本读取提示词（与 `--prompt` 二选一） | - |
| `--ratio`, `--aspect` | `-r` | 画面比例：`16:9`（横屏）或 `9:16`（竖屏） | `16:9` |
| `--res`, `--resolution`| - | 视频清晰度：`720p` 或 `360p` | `720p` |
| `--count` | `-n` | 单次生成批次（默认 `1`，最省点数） | `1` |
| `--project`, `--url` | `-u` | 指定 Flow 项目 URL 或 ID（缺省自动接入当前打开的项目） | - |
| `--out` | `-o` | 资产归档根目录（支持环境变量 `LEO_FLOW_VIDEO_OUT` 覆盖） | `~/google-flow` |
| `--timeout` | `-t` | 最大等待云端渲染时间（秒） | `360` |
| `--dry-run` | - | 仅校验参数与注入提示词，不触发真实生成，不扣点数 | `false` |
| `--help` | `-h` | 查看帮助文档 | - |

---

## 资产归档规范 (参考抖音/短视频项目工程规范)

每个视频任务均会以独立中文文件夹沉淀，结构如下：
```text
~/google-flow/
└── 2026-11-28-flow_两只机械赛博猫在霓虹街道/
    ├── 成片/
    │   ├── 原始版/
    │   │   └── 两只机械赛博猫在霓虹街道_16x9_720p.mp4   # Google Flow 原生生成并下载的原画视频
    │   ├── 发布版/                                  # 预留发布版（含字幕合成）
    │   └── 封面/                                    # 预留封面目录
    ├── 素材/
    │   └── 视频分镜/                                # 预留视频分镜资产
    ├── 音频/                                        # 预留音频/配音
    ├── 字幕/                                        # 预留字幕文件
    ├── 脚本.md                                      # 分镜规格与视听设想
    ├── 交付记录.md                                  # 交付存证报告与多平台 3-Pick 分发战术矩阵
    └── 生成事实.json                                # 机器可读结构化元数据
```

---

## Agent 返回结果格式 (JSON)

执行成功时，标准输出将输出规范的 JSON 供上层 Agent 链式消费：

```json
{
  "ok": true,
  "videoPath": "<homeDir>/google-flow/2026-11-28-flow_cyberpunk_cat/成片/原始版/cyberpunk_cat_16x9_720p.mp4",
  "saveDir": "<homeDir>/google-flow/2026-11-28-flow_cyberpunk_cat",
  "fileSizeMB": "8.58",
  "prompt": "两只机械赛博猫在霓虹街道上跑酷，4k电影质感",
  "ratio": "16:9",
  "resolution": "720p",
  "count": 1,
  "pointsCost": 60,
  "metadataPath": "<homeDir>/google-flow/2026-11-28-flow_cyberpunk_cat/生成事实.json",
  "deliveryReportPath": "<homeDir>/google-flow/2026-11-28-flow_cyberpunk_cat/交付记录.md",
  "scriptPath": "<homeDir>/google-flow/2026-11-28-flow_cyberpunk_cat/脚本.md"
}
```
