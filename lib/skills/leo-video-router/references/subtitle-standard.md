# 视频字幕技术标准：转写、单行重排与院线视效规范

成片字幕要不要加、如何提取转写、排版格式怎么定、如何压制输出，看这里。Step 7 交付前，未烧录字幕的含对白成片统一遵循本标准。

---

## 先判断：成片是否已烧录字幕

Router 只给**没有字幕**的成片保底，不重复压制。已烧录就跳过，否则会叠成两层：

| 下游 | 字幕行为 | 怎么做 |
|---|---|---|
| MoneyPrinterTurbo | 默认烧录（`subtitle_enabled` 默认开启） | 跳过；要统一用本标准，交接时加 `--no-subtitle-enabled` |
| dashi-animationstyle | 开工时问要不要烧录；没人可问时默认烧录，另出 `_无字幕` 版 | 按它的选择；要统一用本标准，选不烧录 |
| hypit、OpenMontage、lemo-opuscar、video-shotcraft | 按项目决定，可能带字幕 | 问下游报告或抽帧确认 |
| huashu-art-motion、xilo-opus-video | 未写明默认带字幕 | 抽帧确认 |

判断不了时抽一帧有对白的画面看底部。

---

## 为什么由 Router 统管字幕标准

1. **交付门禁（Delivery Quality Gate）**：部分下游成片没有字幕，或自带的 ASR 输出粗糙（长句不换行、双行堆叠遮挡主体、无标点气口断句）。
2. **前后对称闭环**：Router 在 Step 5 统一负责音频生成决策（VoiceStudio TTS），Step 7 统一负责成片音频转写与字幕后处理（VoiceStudio STT），形成自洽的视听生产闭环。
3. **跨引擎复用**：下游专注画面生成，没有字幕时由 Router 统一保底。

---

## 环境要求：ffmpeg 必须带 subtitles 滤镜

压制依赖 libass。检查：`ffmpeg -hide_banner -filters | grep subtitles`（Windows 用 `findstr`），有输出才可用。

脚本按顺序找带 subtitles 滤镜的 ffmpeg，找到即用，不写死任何系统路径：

1. 环境变量 `LEO_FFMPEG` 指定的 ffmpeg（设了就只认它）；
2. PATH 上的 `ffmpeg`；
3. Homebrew 的 `ffmpeg-full`（只在装了 brew 的系统上尝试）。

ffprobe 取同目录的那个。

- macOS：Homebrew 标准版 `ffmpeg` 不带 libass，要另装 `brew install ffmpeg-full`。两者可以共存：VoiceStudio 启动时会自动装回标准版 `ffmpeg` 并占用 `/opt/homebrew/bin/ffmpeg`，脚本会自动改用 `ffmpeg-full`，不用卸载。
- Windows：PATH 上的 ffmpeg 要用带 libass 的完整版构建；不是的话，把完整版路径设到 `LEO_FFMPEG`。

脚本带 `--burn`（默认）时会先做这个检查，不满足就在转写前退出。

| `error_type` | 含义 | 怎么做 |
|---|---|---|
| `FFMPEG_NO_SUBTITLES_FILTER` | ffmpeg 未安装或没有 libass | 按上面安装；只要 .srt 就加 `--no-burn` |
| `VOICESTUDIO_NOT_RUNNING` | 重试约 90 秒后 VoiceStudio 仍未响应 | 提示创作者启动，再重跑 |
| `HTTP_<状态码>` | 转写接口报错 | `asr_model_missing` 按下一节装模型；其他错误把原文告诉创作者 |
| `FFMPEG_BURN_FAILED` | .srt 已生成，压制失败 | 把输出里的 ffmpeg 错误告诉创作者 |

失败时退出码为 1，成功为 0。

---

## 转写模型没装：`asr_model_missing`

在 VoiceStudio 的 Model Catalogue → Models 里安装 Whisper large-v3。macOS 上是 MLX 版，约 3 GB。

**开了系统代理时，VoiceStudio 内的下载大概率失败**：它走系统代理，而下载源 `hf-mirror.com` 走代理会出 SSL 错误，直连正常。二选一：

1. 在代理工具里把 `hf-mirror.com` 设为直连，再在 VoiceStudio 里点安装；
2. 绕过代理，直接下载到 VoiceStudio 的模型缓存（macOS 实测；Windows 未验证）：

```bash
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' \
  HF_ENDPOINT=https://hf-mirror.com HF_HUB_DISABLE_XET=1 \
  uv run --with huggingface_hub python -c "from huggingface_hub import snapshot_download; import os; snapshot_download('mlx-community/whisper-large-v3-mlx', revision='<版本>', cache_dir=os.path.expanduser('~/OmniVoiceStudio-Data/data/models'))"
```

`<版本>` 必须和 VoiceStudio 锁定的一致，在它安装目录的 `backend/services/hf_revisions.py` 里查（2026-11 时是 `49e6aa286ad60c14352c404340ded53710378a11`）。下载中断就重跑，会断点续传。下完后 VoiceStudio 的模型列表应显示已安装，不需要重启。

---

## 规则一：音频转写引擎优先级与健康检查

1. **首选本地 VoiceStudio STT**：
   - 接口地址：`http://127.0.0.1:3900/v1/audio/transcriptions`（OpenAI 兼容接口）；
   - 默认模型：`whisper-1`，返回格式 `response_format: verbose_json`；
   - 语言参数：中文默认传 `zh`。
2. **坚决禁止静默降级**：
   - 应用启动后约 60 秒 3900 才响应，脚本连接失败时会重试约 90 秒；
   - 若 VoiceStudio 桌面端仍未运行，**绝不私自静默失败或输出无字幕哑巴视频**；
   - 必须通过 CLI / 对话明确提示创作者：“请先启动 VoiceStudio 桌面端应用（以使用本地语音转写与字幕功能），然后再执行字幕生成。”
   - 待用户启动 VoiceStudio 后，再继续执行转写。

---

## 规则二：台词单行独立重排算法（Single-Line Reflow）

原生 Whisper 吐出的原始字幕经常单条达 30~50 字，甚至包含堆叠多行换行符（`\n`），直接压制会导致严重遮挡画面构图。

本规范确立**【单行独立重排算法】**：

1. **绝对严禁多行堆叠**：单条字幕彻底剔除 `\r`、`\n`，保证视觉呈现 100% 单行。
2. **天然呼吸气口断句**：
   - 优先依据中文标点符号（`，。！？；：`）将长句拆解为符合口语呼吸节奏的独立短子句；半角 `!?,;` 后面跟空白才算断句，不切开 `1,000` 这样的数字；
   - 清除子句首尾的无意义机械符号，句末 `！？` 保留语气。
3. **单行字数物理硬约束**：
   - 每行显示宽度严格限制在 ≤ 16 字：汉字等全角字符记 1，拉丁字母等半角字符记 0.5；
   - 若按标点切分后子句仍超过上限，按等宽均匀细分：拉丁单词整词换行，只有超长单词才硬切。
4. **时间戳比例插值分配（Proportional Timing Interpolation）**：
   - 细分出的各单行片段，依据各自显示宽度占原总句的比例，等比例计算 `start` 与 `end` 时间戳；
   - 转写只返回全文、没有分段时，时间轴用音频真实时长。
5. **最短展示与防重叠（Overlap Elimination）**：
   - 单行字幕最小展示时长（`min_duration`）不低于 0.8 秒，防止语速过快导致字幕闪现不可读；
   - 两条字幕重叠时，把下一条的 `start` 后移，确保时间轴单向递增无交错。语速持续过快时字幕会短暂滞后，到下一个停顿追平。

---

## 规则三：院线级排版视效标准（Cinema Style）

字幕压制进画面时，遵循以下影视/短剧级 ASS/SRT 视效参数：

| 视觉属性 | 推荐值 | 说明 |
|---|---|---|
| **字体 (Fontname)** | `Microsoft YaHei`（Windows） / `PingFang SC`（macOS） / `Noto Sans CJK SC`（其他） | 脚本按系统自动选择，`--font` 可覆盖 |
| **字号 (FontSize)** | `20`（SRT 按 288 高度缩放，横屏 1080P 约 75px） | 竖屏自动收窄，保证满行不超过画面宽 90%；描边和投影同比缩放 |
| **字心颜色 (PrimaryColour)** | `&H00FFFFFF`（纯白微光） | 在任何暗色背景下保持最高反差 |
| **描边与投影 (Outline & Shadow)** | `OutlineColour=&H00000000`, `Outline=2`, `Shadow=1` | 极细黑边加柔和投影，在雪地、强光源或亮背景下依然清晰 |
| **排版样式 (BorderStyle)** | `1` | 轮廓加阴影模式 |
| **底部垂直边距 (MarginV)** | `35` ~ `50` | 适度上移，避开各视频播放器底部进度条与标题，同时绝不遮挡人物下巴或胸口关键构图 |

---

## 命令行调用指引

脚本路径：`<本 skill 目录>/scripts/subtitle_engine.py`

### 1. 转写并压制完整成片（默认推荐）
```bash
python3 <本 skill 目录>/scripts/subtitle_engine.py "<工程目录>/成片/原始版/raw_video.mp4" --burn
```
`subtitle_engine.py` 会自动识别标准工程目录，并将产物智能输出至 `成片/发布版/`：
- `<工程目录>/成片/发布版/raw_video.srt`（单行重排标准字幕）
- `<工程目录>/成片/发布版/raw_video_with_subtitles.mp4`（压制院线排版成片）

### 2. 仅生成 .srt 字幕文件（不重新编码压制视频）
```bash
python3 <本 skill 目录>/scripts/subtitle_engine.py "<工程目录>/成片/原始版/raw_video.mp4" --no-burn
```

### 3. 自定义单行字数、字体与输出路径
```bash
python3 <本 skill 目录>/scripts/subtitle_engine.py "input.mp4" \
  --output-srt "custom.srt" \
  --output-video "custom_subtitled.mp4" \
  --max-chars 14 \
  --font "Noto Sans CJK SC" \
  --json
```
