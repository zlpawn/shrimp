# 场景指南 2：MiniMax-H3 音画同步文生视频与多图参考生视频 (Text/Ref-to-Video + Audio)

本文档指导 Agent 使用 **MiniMax-H3 音画一体标准工作流** 进行文生视频（Text-to-Video + Native Audio）与参考图生视频（Reference-to-Video + Native Audio）。

* **对应成熟工作流模板**：[minimax_h3_video_1pass_api.json](../workflows/minimax_h3_video_1pass_api.json)
* **远端源工作流**：`/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_built_in_audio_builder_api.json`

---

## 1. 工作流核心拓扑与节点字典 (`minimax_h3_video_1pass_api.json`)

该工作流共 15 个节点，在云端 RTX 5090 上 10 步渲染仅需 **约 19~25 秒**，同时输出 **1280x736 (24fps) 视频画面** 与 **原生同步生成的 AAC 音轨**。

| 节点 ID | 节点类型 (`class_type`) | 核心输入槽位与默认值 | 作用与可调参数 |
| :--- | :--- | :--- | :--- |
| **`"115"`** | `ResolutionSelector` | `aspect_ratio`: `"16:9 (Widescreen)"`<br/>`megapixels`: `0.9`, `multiple`: `32` | 控制画幅比例（支持 `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`）与总像素（`0.9` 对应 `1280x736`） |
| **`"141"`** | `DiffusionModelLoaderKJ` | `model_name`: `minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 加载 H3 音视频联合扩散主模型（启用 `sage_attention="auto"`, `enable_fp16_accumulation=True`） |
| **`"174"`** | `EasyCache` | `reuse_threshold`: `0.3`, `start_percent`: `0.2`, `end_percent`: `0.9` | 特征复用缓存加速。若需更高画质可将该阈值调低至 `0.1` |
| **`"128"`** | `CLIPLoader` | `clip_name`: `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 32B 多模态编码器，同时解析视觉描述、镜头运动、台词与音效指令 |
| **`"119"` / `"120"`** | `VAELoader` | 视频 VAE: `minimax_h3_video_vae_fp16.safetensors`<br/>音频 VAE: `minimax_h3_audio_vae_fp32.safetensors` | 分别负责视频帧与音频波形的编解码 |
| **`"132"` $\to$ `"131"`** | `PrimitiveFloat` $\to$ `ComfyMathExpression` | `value`: `3.0`（秒）$\to$ 公式 `max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17` | **重要机制**：MiniMax-H3 视频帧数 `length` 必须满足 **$17n + 5$**（如 `5, 22, 39, 56, 73, 90, 107, 124...`），节点 `131` 会自动把秒数对齐到合法帧数 |
| **`"180"`** | `VRGDG_MiniMaxH3ReferenceMediaFromPaths` | `image_paths`: `"[]"`, `video_references`: `"[]"` | 接收最多 9 张参考图与 3 段参考视频路径 |
| **`"138"` $\to$ `"136"`** | `PrimitiveStringMultiline` $\to$ `MiniMaxH3ReferenceToVideo` | `ref_image_size`: `"match"`（或 `"max"`） | 构建音视频联合 Conditioning 与潜空间 |
| **`"123"` / `"124"` / `"125"`** | `KSamplerSelect` / `BasicScheduler` / `SamplerCustomAdvanced` | `sampler_name`: `"res_multistep"`, `scheduler`: `"simple"`, `steps`: `10` | 音画潜变量同步去噪采样 |
| **`"121"` / `"122"` $\to$ `"142"`** | `LTXVAudioVAEDecode` / `VAEDecode` $\to$ `VHS_VideoCombine` | `frame_rate`: `24`, `format`: `"video/h264-mp4"`, `crf`: `19` | 解码音频与画面并压制为带声音的 `.mp4` 文件 |

---

## 2. 音画同步提示词编写公式 (Prompt Engineering for Video + Audio)

MiniMax-H3 能够原生联合生成**画面 + 环境音效 + 动作拟音 (Foley) + 角色台词/歌声 + 背景音乐**。Agent 在构造 Prompt 时应包含以下四个维度：

```text
[1. 画面主体与环境光影] + [2. 镜头运镜与主体动作时序] + [3. Audio Direction: 环境音/动作拟音/BGM风格] + [4. Dialogue/Lyrics: 精确台词或唱词(如有)]
```

### 2.1 纯文生视频调用示例
```bash
& $PYTHON_BIN $CLI_PATH --video \
  --prompt "A sleek futuristic cyberpunk sports car speeding along a rain-slicked neon highway at night, water splashing from tires, dynamic low-angle tracking shot, cinematic lighting, 8k hyperrealistic. Audio direction: deep roaring V8 futuristic engine sound, heavy rain pattering on metal, tires screeching on wet asphalt, distant thunder rumbling, dark synthwave bass background music." \
  --duration 4.0 --aspect-ratio "16:9" --steps 10 --json
```

### 2.2 参考图生视频 / 先用 H3 生图再用 H3 生视频串联玩法
1. **第一步**：调用 `--image` 生成角色或场景定妆照（保存在 `~/.shrimp/skills/leo-autodl-imagine-video/outputs/MiniMaxH3_Image_00001_.png`）。
2. **第二步**：将该图通过 `--ref-images` 传入 `--video`，让角色动起来并开口说话：
   ```bash
   & $PYTHON_BIN $CLI_PATH --video \
     --ref-images "C:/Users/xtea/.shrimp/skills/leo-autodl-imagine-video/outputs/MiniMaxH3_Image_00001_.png" \
     --ref-image-size max \
     --prompt "参考图1中的赛博朋克少女站在霓虹雨夜街头，雨水顺着发丝滑落，她缓缓转头望向镜头，眼神冷冽，轻声说道：'任务已经完成，撤离。' 镜头缓慢推近至面部特写。Audio direction: 清晰清冷的年轻女性中文配音说：'任务已经完成，撤离。' 伴随真实的雨滴落下声与低沉科幻电子环境音，无杂音。" \
     --duration 4.0 --aspect-ratio "16:9" --steps 12 --json
   ```
