# leo-video-router 设计

日期：2026-10-31
状态：设计已确认，待实现

## 1. 目标

做一个和 `leo-imagine-router` 同构的视频场景路由 skill：用户提出视频需求后，识别场景，把需求交给最适合的开源项目或 skill，并在缺失时引导安装。

**职责边界（硬约束）**

- Router 只回答「这个场景交给谁」，**不选择、不调用任何底层生成引擎**（Seedance、MiniMax-H3、Kling 等由下游自己决定）。
- 下游项目怎么执行，由它自己的入口文档说明（`SKILL.md` / `AGENTS.md` / CLI），Router 只负责交接。
- Skill 必须**独立可用、不绑定 agent**：所有调研和验证得到的接入知识写进 skill 自己的 `references/`，不依赖任何 agent 的记忆或私有工具。

## 2. 文件结构

```
lib/skills/leo-video-router/
├── SKILL.md                    流程主干
├── README.md                   人看的介绍与安装方式
└── references/
    ├── routing-matrix.md       场景路由矩阵与重叠项目的区分规则
    ├── projects/<项目>.md       每个项目一张接入卡
    ├── audio-omnivoice.md      音频决策顺序与 omnivoice 接入细节
    ├── install-and-registry.md 安装卡片模板、下载目录、registry.json
    └── fallback.md             未命中场景时的通用视频提示词规范与兜底执行
```

运行期数据（不在 skill 目录内，换 agent、重装 skill 都不丢）：

```
~/.shrimp/skills/leo-video-router/registry.json
~/.shrimp/skills/<项目名>/            源码类项目的默认下载目录
```

## 3. 工作流（SKILL.md 主干）

1. **场景导航**：需求模糊（只调用 skill、问「能做什么」、给了素材但没说方向）时，先展示场景导航卡片。
2. **意图分类**：按 `routing-matrix.md` 的触发词和区分规则选出一个项目；有歧义时给 2 个候选让用户选。
3. **探测**：按第 6 节的顺序查找项目是否已在本地。
4. **安装引导**：未找到 → 展示安装卡片（第 6 节），用户同意后由 agent 执行；用户拒绝 → 走兜底。
5. **音频决策**：按第 5 节判断是否需要 omnivoice 先生成配音。
6. **交接**：读该项目的接入卡和它自己的入口文档，把用户需求、配音文件路径（如有）交给它执行。
7. **交付**：给出成片路径；说明用了哪个项目、音频来源。

## 4. 场景路由矩阵

去掉 `mg-styles-15`（只是 15 份提示词，不是 skill，固定 10 秒，风格基本被 lemo-opuscar 覆盖，自由创作被 xilo-opus-video 覆盖）。保留 8 个：

| 场景 | 项目 | 画面来源 | 音频类型 | 入口 |
|---|---|---|---|---|
| 给个主题，快速或批量出「旁白 + 素材混剪 + 字幕 + BGM」的竖屏信息流短视频 | MoneyPrinterTurbo | 素材库关键词匹配，可选生成模型 | 内生 | skill `moneyprinterturbo-video` |
| 已有素材的加工：真人口播剪辑、长视频切短、播客转视频、多语字幕与配音、录屏演示、档案素材纪录片、预告片、主题讲解、数字人口播 | OpenMontage | 素材优先，Python 工具 + 13 条 pipeline | 内生 | 源码，读 `AGENT_GUIDE.md` |
| 用 AI 生成的人物表演：UGC 口播、短剧、双人播客、街头采访、排行榜、讲解员 + MG、旁白带货 | hypit | 生成优先，以词为锚的时间轴 | 内生 | skill `hypit` |
| 指定风格的代码短片（66 种风格，含「剪辑与纪实」「实证影像」），保存自己的风格 | lemo-opuscar | 代码逐帧 | 内生（可外配） | skill `lemo-opuscar` |
| 不限风格的代码视频：先出三个方案加预览、按用户音乐卡点、绿幕人物 + 代码场景、Manim、只要提示词 | xilo-opus-video | 代码逐帧 | 可选 | skill `xilo-opus-video` |
| 中文知识口播（15–60 秒）→ 风格讲解动画，可直接拖进剪映 | dashi-animationstyle | 代码逐帧 | **必须先有口播** | skill `dashi-animationstyle` |
| 具名艺术家笔法、名画穿越、YouTube 解说语法（Vox / 3b1b / Kurzgesagt / 白板 / 财经） | huashu-art-motion | 代码 + 生成帧 | 可选 | skill `huashu-art-motion` |
| 用真实网页做产品宣传片（镜头卡、Ink Press 模板、导出剪映工程），或给已有视频配音效 | video-shotcraft | 真实页面截图 + Remotion | 无旁白 | skill `video-shotcraft` |

**重叠项目的区分规则**

- 要 AI 生成人物表演 → hypit；加工已有素材 → OpenMontage。两者都能复刻参考视频：社媒真人表演类 → hypit，混剪 / 预告 / 讲解类 → OpenMontage。
- 「批量」「快速出一条」「信息流」「矩阵号」「给个主题就行」 → MoneyPrinterTurbo；要镜头设计和风格 → 代码视频类或 OpenMontage。
- 点名艺术家或要「穿越」 → huashu；风格在 lemo 目录里 → lemo。
- 已有或要生成口播的中文讲解 → dashi。
- 没指定风格、想先看几个方案、要绿幕合成或 Manim → xilo。
- 产品宣传片一律 → video-shotcraft。

## 5. 音频决策

**背景**：不配商业 API Key 时，各项目的免费 TTS 都很一般（MoneyPrinterTurbo 用 Edge TTS；lemo 中文用 edge-tts，作者自己说 Kokoro 中文 "sound plain"；OpenMontage 用 Piper 兜底；huashu 用 macOS `say`）。2026-10-31 同一段中文对比试听：omnivoice 与 Edge TTS 接近，omnivoice 更像真人。

**决策顺序**

1. 用户给了录音 → 直接用。
2. 用户在下游项目里配了商业 TTS 并想用 → 用下游自带的。
3. 其余情况 → **omnivoice 生成配音**，从下游的外部音频入口传入。
4. omnivoice 不可用 → 提示用户启动 VoiceStudio；用户不想开，就退回下游的免费 TTS，并说明音质有限。

**例外**：音频必须和画面一起生成的场景不替换（音画同步模型、AI 人物开口说话），否则口型对不上。只有模型接受音频输入时（如图片 + 音频对口型），才先出 omnivoice 音频再交给它。

**各项目的外部音频入口**

| 项目 | 入口 | 状态 |
|---|---|---|
| MoneyPrinterTurbo | `--custom-audio-file`，配合 `--video-script` 让文案与配音一致 | 参数存在；自定义音频时的字幕生成方式未验证 |
| OpenMontage | 单条命令前加 `OPENAI_API_KEY=none OPENAI_BASE_URL=http://127.0.0.1:3900/v1`，显式调用 `openai_tts` 并传 `model: tts-1` | 已实测成功（见 6.4） |
| hypit | 支持用户提供的录音，或作为音色克隆参考 | 文档确认 |
| lemo-opuscar | `TECHNIQUE.md` §4：用户带录音就用录音 | 文档确认 |
| xilo-opus-video | 文档写明接受用户自己的语音 | 文档确认 |
| dashi-animationstyle | `新建作品.mjs --audio <文件>`，必填 | 代码确认 |
| huashu-art-motion | `capabilities.py use-audio --audio <文件>` | 代码确认 |
| video-shotcraft | 不需要 | — |

**omnivoice 接入细节**（写进 `audio-omnivoice.md`）

- 接口：OpenAI 兼容，`http://127.0.0.1:3900/v1`；`/v1/audio/speech` 生成，`/v1/audio/voices` 列音色。
- 3902 端口是 VoiceStudio 的控制服务，不是语音引擎；应用启动后约 60 秒 3900 才就绪。健康检查必须带重试，不能一次失败就判定不可用。
- 实测速度：12.5 秒音频，冷启动 40 秒、热启动 22 秒（Apple Silicon MPS）。
- 语音转文字需要先在 VoiceStudio 下载 Whisper 模型（约 3 GB），未下载时返回 `asr_model_missing`。字幕仍由各项目自己的 whisper 负责。

## 6. 探测、安装与 registry

### 6.1 探测顺序

1. `~/.shrimp/skills/leo-video-router/registry.json` 里登记的路径；

（由 `scripts/registry.py locate` 统一实现第 1、3、4、5 步：入口文件按 frontmatter `name` 或 OpenMontage 文件头校验，输出 `entry_dir` 作为交接时的 skill 目录；registry 损坏时报错退出、不覆盖。）

2. agent 上下文中的可用 skill 列表；
3. 标准 skill 目录：`~/.agents/skills/<名>`、`~/.claude/skills/<名>`、`~/.codex/skills/<名>`、`~/.gemini/config/skills/<名>`；
4. 默认下载目录：`~/.shrimp/skills/<项目名>`；
5. 当前工作区：`./lib/skills/<名>`、`./.agents/skills/<名>`。

### 6.2 安装卡片

- 先问用户要不要指定目录；不指定就用 `~/.shrimp/skills/<项目名>`。
- skill 类：展示 `npx skills add <repo> -g -y`（`-y` 免交互，安装目录名 = skill 名，已在临时 HOME 实装验证）；多个项目逐个安装，并行 clone 实测会中断；源码类：展示 `git clone <url> <目录>`。用户同意后由 agent 执行。
- 用户说「已经 clone 在某某目录」→ 校验目录里有入口文件后写进 registry，不重复下载。
- 依赖安装（uv、npm、ffmpeg 等）按项目自己的文档进行，Router 不管。
- 自带「全自动、不问确认」规则的项目（如 MoneyPrinterTurbo 的 skill）：Router 先拿到用户同意再交接，交接后由它自动跑完。

| 项目 | 安装命令 | 验证情况 |
|---|---|---|
| MoneyPrinterTurbo | `npx skills add harry0703/MoneyPrinterTurbo -g -y`；源码目录用 helper 的 `--root` 指定 | `--list` 识别到 `moneyprinterturbo-video` |
| lemo-opuscar | `npx skills add lemomo-ai/lemo-opuscar -g -y`；风格库目录用 `LEMO_OPUSCAR_HOME` 指定 | `--list` 识别到 `lemo-opuscar` |
| OpenMontage | `git clone https://github.com/calesthio/OpenMontage.git <目录>`，**不要用 `npx skills add`** | `--list` 找到的是它内部 `.agents/skills/` 下的 89 个工具类 skill（threejs-*、text-to-speech 等），不是入口，全局安装会污染 skill 列表 |
| hypit | `npx skills add hypit-ai/hypit -g -y` | `--list` 识别到 `hypit` |
| huashu-art-motion | `npx skills add alchaincyf/huashu-art-motion -g -y` | `--list` 识别到 `huashu-art-motion`；仓库约 77 MB，第一次 clone 因网络中断失败，重试成功，安装失败时应重试一次 |
| video-shotcraft | `npx skills add Vincentwei1021/video-shotcraft -g -y` | `--list` 识别到 `video-shotcraft` |
| xilo-opus-video | `npx skills add Kianzzz/xilo-opus-video -g -y` | `--list` 识别到 `xilo-opus-video` |
| dashi-animationstyle | `npx skills add chuspeeism/dashi-animationstyle -g -y` | `--list` 识别到 `dashi-animationstyle` |

### 6.3 registry.json

```json
{
  "version": 1,
  "projects": {
    "OpenMontage": { "path": "/path/to/OpenMontage", "source": "user", "added": "2026-10-31" }
  }
}
```

- `source`：`user`（用户指定的已有目录）或 `install`（Router 安装时写入）。
- 读取时校验路径仍存在且有入口文件，失效就删掉这条并重新走探测。

### 6.4 OpenMontage 接 omnivoice 的实测结论

- 成功：上述环境变量 + `model: tts-1` + `response_format: wav`，生成 12.48 秒 wav。
- 不传 model 时默认 `gpt-4o-mini-tts`，omnivoice 返回 400。
- **不能写进 `.env`**：同一进程里 `openai_image` 会被发到 omnivoice（返回 405），preflight 还会把 `openai_image`、`sora_video` 误标为可用。OpenMontage 每次用单独的 `python -c` 进程调工具，按命令设变量即可隔离。

## 7. 兜底

未命中任何场景，或用户拒绝安装推荐项目时：

1. 按 `fallback.md` 的通用视频提示词规范（主体、场景、动作、运镜、风格、时长与画幅、声音）整理需求；
2. 从环境中找可用的视频生成 skill（如 leo-huoshan-imagine、leo-grok-imagine、leo-autodl-imagine-video），按它自己的文档执行；有多个让用户选，一个都没有就只交付提示词。

Router 不点名、不写死任何兜底 skill 的命令行。

## 8. 验收

拿真实需求走一遍，检查路由、安装卡片和音频环节：

1. 「给个主题，批量出 3 条抖音短视频」 → MoneyPrinterTurbo
2. 「把这段口播做成手绘笔记风格动画」 → dashi
3. 「用梵高风格做一段 30 秒动画」 → huashu
4. 「给我的产品网站做支宣传片」 → video-shotcraft
5. 「做一段 AI 生成的街头采访」 → hypit
6. 「把这个 1 小时播客切成 5 条短视频」 → OpenMontage
7. 模糊需求「我想做个视频」 → 展示场景导航卡片

## 9. 不做

- 不改动任何下游项目的代码。
- 不内置任何生成引擎调用。
- 不为非 skill 项目额外包一层 skill（方案 A：直接读它们自己的入口文档）。
