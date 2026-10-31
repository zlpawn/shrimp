# 音频决策：何时用 omnivoice

配音要不要用本机 omnivoice（VoiceStudio，OpenAI 兼容 TTS）生成、生成后怎么交给下游，看这里。各项目的具体参数看接入卡的「音频」节。

## 为什么优先 omnivoice

不配商业 API Key 时，各项目的免费 TTS 都很一般（MoneyPrinterTurbo 用 Edge TTS；lemo 中文用 edge-tts，作者自己说 Kokoro 中文 "sound plain"；OpenMontage 用 Piper 兜底；huashu 用 macOS `say`）。2026-10-31 同一段中文对比试听：omnivoice 与 Edge TTS 接近，omnivoice 更像真人。

## 决策顺序

1. 用户给了录音 → 直接用。
2. 用户在下游项目里配了商业 TTS 并想用 → 用下游自带的。
3. 其余情况 → **omnivoice 生成配音**，从下游的外部音频入口传入。
4. omnivoice 不可用 → 提示用户启动 VoiceStudio；用户不想开，就退回下游的免费 TTS，并说明音质有限。

**例外**：音频必须和画面一起生成的场景不替换（音画同步模型、AI 人物开口说话），否则口型对不上。只有模型接受音频输入时（如图片 + 音频对口型），才先出 omnivoice 音频再交给它。

## 各项目怎么接

| 项目 | 入口 |
|---|---|
| [MoneyPrinterTurbo](projects/MoneyPrinterTurbo.md#音频) | `--custom-audio-file <wav 绝对路径>` 配合 `--video-script` 让文案与配音一致；要出字幕先设 `subtitle_provider = "whisper"` |
| [OpenMontage](projects/OpenMontage.md#音频) | 只在调用 TTS 的那一条命令前加 `OPENAI_API_KEY=none OPENAI_BASE_URL=http://127.0.0.1:3900/v1`，显式调用 `openai_tts` 并传 `model: tts-1`；不写进 `.env` |
| [hypit](projects/hypit.md#音频) | 按「用户提供的录音」交给它（表演音轨或克隆参考）；AI 人物开口说话的镜头不替换 |
| [lemo-opuscar](projects/lemo-opuscar.md#音频) | `TECHNIQUE.md` §4：用户带录音就用录音，omnivoice 配音按录音交给它 |
| [xilo-opus-video](projects/xilo-opus-video.md#音频) | 按用户自己的语音交给它 |
| [dashi-animationstyle](projects/dashi-animationstyle.md#音频) | `--audio <文件>` 必填，文案同时存为稿子传 `--script` |
| [huashu-art-motion](projects/huashu-art-motion.md#音频) | `capabilities.py use-audio --audio <文件>` |
| [video-shotcraft](projects/video-shotcraft.md#音频) | 不需要（无旁白） |

## omnivoice 接口

OpenAI 兼容，`http://127.0.0.1:3900/v1`：`/v1/audio/speech` 生成，`/v1/audio/voices` 列音色。

1. 健康检查（带重试，最多约 90 秒）：

   ```bash
   curl -s -m 90 --retry 15 --retry-connrefused --retry-delay 5 http://127.0.0.1:3900/health
   ```

   正常返回 `{"status":"ok",...}`。不能一次失败就判定不可用。

2. 列音色：`curl -s http://127.0.0.1:3900/v1/audio/voices`。优先用用户的克隆音色 `voice_id`，没有就用 `alloy` 等 OpenAI 别名（映射到当前引擎默认音色）。

3. 生成：

   ```bash
   curl -s http://127.0.0.1:3900/v1/audio/speech \
     -H "Content-Type: application/json" \
     -d '{"model":"tts-1","voice":"<voice_id>","input":"<文案>","response_format":"wav"}' \
     -o narration.wav
   ```

说明：3902 端口是 VoiceStudio 控制服务，不是语音引擎；应用启动后约 60 秒 3900 才响应。不可用时提示用户启动 VoiceStudio，不要擅自换云端服务。

## 实测数据（2026-10-31，Apple Silicon MPS）

- 12.5 秒中文音频：冷启动 40 秒、热启动 22 秒。
- 输出 24 kHz 单声道 16-bit wav。
- 语音转文字需先在 VoiceStudio 下载 Whisper 模型（约 3 GB），否则返回 `asr_model_missing`；字幕交给各项目自己的 whisper。
