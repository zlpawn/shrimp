# 视频字幕技术标准：转写、单行重排与院线视效规范

成片字幕要不要加、如何提取转写、排版格式怎么定、如何压制输出，看这里。下游各项目（OpenMontage、MoneyPrinterTurbo、hypit、lemo-opuscar、AutoDL 渲染成片等）在 Step 7 交付前统一遵循本标准。

---

## 为什么由 Router 统管字幕标准

1. **交付门禁（Delivery Quality Gate）**：各下游生视频引擎输出的原始视频往往没有字幕，或自带的 ASR 输出粗糙（长句不换行、双行堆叠遮挡主体、无标点气口断句）。
2. **前后对称闭环**：Router 在 Step 5 统一负责音频生成决策（VoiceStudio TTS），Step 7 统一负责成片音频转写与字幕后处理（VoiceStudio STT），形成自洽的视听生产闭环。
3. **跨引擎复用**：避免每个下游生成 skill 各自实现一套重复且参差不齐的字幕逻辑，下游专注画面生成，字幕后处理由 Router 统一保底。

---

## 规则一：音频转写引擎优先级与健康检查

1. **首选本地 VoiceStudio STT**：
   - 接口地址：`http://localhost:3900/v1/audio/transcriptions`（OpenAI 兼容接口）；
   - 默认模型：`whisper-1`，返回格式 `response_format: verbose_json`；
   - 语言参数：中文默认传 `zh`。
2. **坚决禁止静默降级**：
   - 若 VoiceStudio 桌面端未运行，**绝不私自静默失败或输出无字幕哑巴视频**；
   - 必须通过 CLI / 对话明确提示创作者：“请先启动 VoiceStudio 桌面端应用（以使用本地语音转写与字幕功能），然后再执行字幕生成。”
   - 待用户启动 VoiceStudio 后，再继续执行转写。

---

## 规则二：台词单行独立重排算法（Single-Line Reflow）

原生 Whisper 吐出的原始字幕经常单条达 30~50 字，甚至包含堆叠多行换行符（`\n`），直接压制会导致严重遮挡画面构图。

本规范确立**【单行独立重排算法】**：

1. **绝对严禁多行堆叠**：单条字幕彻底剔除 `\r`、`\n`，保证视觉呈现 100% 单行。
2. **天然呼吸气口断句**：
   - 优先依据中文标点符号（`，。！？；：`）将长句拆解为符合口语呼吸节奏的独立短子句；
   - 清除句末残留的无意义机械符号。
3. **单行字数物理硬约束**：
   - 每行汉字数严格限制在 $\le 16$ 字（极值不超过 18 字）；
   - 若按标点切分后子句仍超过上限，按等长字数切片均匀细分。
4. **时间戳字数比例插值分配（Proportional Timing Interpolation）**：
   - 细分出的各单行片段，依据各自字符数占原总句字符数的比例，等比例计算 `start` 与 `end` 时间戳；
   - 单行字幕最小展示时长（`min_duration`）不低于 $0.8$ 秒，防止语速过快导致字幕闪现不可读。
5. **时间轴防重叠修正（Overlap Elimination）**：
   - 遍历相邻字幕片段，若上一句的 `end` 大于下一句的 `start`，自动对齐截断，确保时间轴单向递增无交错。

---

## 规则三：院线级排版视效标准（Cinema Style）

字幕压制进画面时，遵循以下影视/短剧级 ASS/SRT 视效参数：

| 视觉属性 | 推荐值 | 说明 |
|---|---|---|
| **字体 (Fontname)** | `Microsoft YaHei`（Windows） / `PingFang SC`（macOS） | 现代无衬线中黑体，高辨识度，避免繁琐艺术字 |
| **字号 (FontSize)** | `20`（以 1080P/4K 等比基准） | 适中偏精细，清晰可辨同时不喧宾夺主 |
| **字心颜色 (PrimaryColour)** | `&H00FFFFFF`（纯白微光） | 在任何暗色背景下保持最高反差 |
| **描边与投影 (Outline & Shadow)** | `OutlineColour=&H00000000`, `Outline=2`, `Shadow=1` | 极细黑边加柔和投影，在雪地、强光源或亮背景下依然清晰 |
| **排版样式 (BorderStyle)** | `1` | 轮廓加阴影模式 |
| **底部垂直边距 (MarginV)** | `35` ~ `50` | 适度上移，避开各视频播放器底部进度条与标题，同时绝不遮挡人物下巴或胸口关键构图 |

---

## 命令行调用指引

脚本路径：`<本 skill 目录>/scripts/subtitle_engine.py`

### 1. 转写并压制完整成片（默认推荐）
```bash
python <本 skill 目录>/scripts/subtitle_engine.py "<工程目录>/成片/原始版/raw_video.mp4" --burn
```
`subtitle_engine.py` 会自动识别标准工程目录，并将产物智能输出至 `成片/发布版/`：
- `<工程目录>/成片/发布版/raw_video.srt`（单行重排标准字幕）
- `<工程目录>/成片/发布版/raw_video_with_subtitles.mp4`（压制院线排版成片）

### 2. 仅生成 .srt 字幕文件（不重新编码压制视频）
```bash
python <本 skill 目录>/scripts/subtitle_engine.py "<工程目录>/成片/原始版/raw_video.mp4" --no-burn
```

### 3. 自定义单行字数与输出路径
```bash
python <本 skill 目录>/scripts/subtitle_engine.py "input.mp4" \
  --output-srt "custom.srt" \
  --output-video "custom_subtitled.mp4" \
  --max-chars 14 \
  --json
```
