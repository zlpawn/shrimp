# 场景指南 2：MiniMax-H3 音画同步生视频实测记录 (Text/Ref-to-Video + Audio)

本文档记录了直接源自远端 `/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_built_in_audio_builder_api.json` 并在云端 RTX 5090 上**真机实测跑通**的音画一体视频生成工作流。

* **已验证 API 工作流模板**：[minimax_h3_video_1pass_api.json](../workflows/minimax_h3_video_1pass_api.json)

---

## 1. 已上机验证的 15 节点音画同步工作流 (`minimax_h3_video_1pass_api.json`)

> **真机排障沉淀**：远端原文件 `minimax_built_in_audio_builder_api.json` 的节点 `141` (`DiffusionModelLoaderKJ`) 原始写的 `model_name` 是 `"minimax_h3_ref2va_pruned_int8_convrot.safetensors"`，直接提交会报错找不到模型；经查 `/object_info/DiffusionModelLoaderKJ`，真实路径带有子目录前缀 `"minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"`。本地模板 `minimax_h3_video_1pass_api.json` 已修正此问题并实测通过。

| 节点 ID | 节点类型 (`class_type`) | 原生参数配置 | 节点功能说明 |
| :--- | :--- | :--- | :--- |
| **`"115"`** | `ResolutionSelector` | `aspect_ratio`: `"16:9 (Widescreen)"`<br/>`megapixels`: `0.9`, `multiple`: `32` | 自动计算 32 倍数对齐的分辨率（`0.9 MP` 在 `16:9` 下输出 `1280x736`）。可选比例枚举：`1:1 (Square)`, `2:3 (Portrait Photo)`, `3:2 (Photo)`, `3:4 (Portrait Standard)`, `4:3 (Standard)`, `9:16 (Portrait Widescreen)`, `16:9 (Widescreen)`, `21:9 (Ultrawide)` |
| **`"141"`** | `DiffusionModelLoaderKJ` | `model_name`: `"minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"`<br/>`sage_attention`: `"auto"`, `enable_fp16_accumulation`: `true` | 加载 MiniMax-H3 扩散主模型 |
| **`"174"`** | `EasyCache` | `reuse_threshold`: `0.3`, `start_percent`: `0.2`, `end_percent`: `0.9`, `model`: `["141", 0]` | 采样特征缓存加速节点 |
| **`"128"`** | `CLIPLoader` | `clip_name`: `"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"`, `type`: `"minimax"` | 加载 Qwen3-VL 32B 文本与多模态编码器 |
| **`"119"`** | `VAELoader` | `vae_name`: `"minimax_h3_video_vae_fp16.safetensors"` | 加载视频 VAE |
| **`"120"`** | `VAELoader` | `vae_name`: `"minimax_h3_audio_vae_fp32.safetensors"` | 加载音频 VAE |
| **`"132"`** | `PrimitiveFloat` | `value`: `3.0` | 视频目标秒数（可修改） |
| **`"131"`** | `ComfyMathExpression` | `expression`: `"max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17"` | 将节点 `132` 的秒数按 24fps 自动换算为满足 $17n+5$ 约束的合法帧数 `length` |
| **`"138"`** | `PrimitiveStringMultiline` | `value`: `<提示词>` | 输入包含画面、台词与声音指示的提示词 |
| **`"180"`** | `VRGDG_MiniMaxH3ReferenceMediaFromPaths` | `image_paths`: `"[]"`, `video_references`: `"[]"` | 接收 JSON 数组格式的远端参考图/参考视频路径，输出连接至节点 `136` 的 `ref_images.ref_image_0 ~ 8` 和 `ref_videos.ref_video_0 ~ 2` |
| **`"136"`** | `MiniMaxH3ReferenceToVideo` | 连接 `138`, `115`, `131`, `128`, `119`, `120`, `180`，`ref_image_size`: `"match"` | 构建音视频联合 Conditioning 与初始 Latent |
| **`"129"`** | `RandomNoise` | `noise_seed`: `<随机种子>` | 随机噪声种子 |
| **`"123"` / `"124"` / `"126"` / `"125"`** | `KSamplerSelect` / `BasicScheduler` / `BasicGuider` / `SamplerCustomAdvanced` | `sampler_name`: `"res_multistep"`, `scheduler`: `"simple"`, `steps`: `10` | 高阶自定义采样器，执行音视频联合去噪 |
| **`"121"` / `"122"`** | `LTXVAudioVAEDecode` / `VAEDecode` | 分别用节点 `120` (Audio VAE) 和 `119` (Video VAE) 解码节点 `125` 的输出 | 分离解码出音频波形与视频画面序列 |
| **`"142"`** | `VHS_VideoCombine` | `frame_rate`: `24`, `format`: `"video/h264-mp4"`, `pix_fmt`: `"yuv420p"`, `crf`: `19` | 将视频帧与原生音频压制合并为带音轨的 `.mp4` 文件 |

---

## 2. 实测性能与调用命令

在云端 **RTX 5090 (32GB)** 上实测：
* `duration=3.0`, `steps=10`：采样耗时 **19 秒**，含音视频解码与 SFTP 回传全流程约 **25 秒**，产出带同步音效的 `1280x736` MP4 视频。

```bash
PYTHON_BIN="$HOME/.shrimp/skills/leo-autodl-imagine-video/.venv/Scripts/python.exe"
CLI_PATH="lib/skills/leo-autodl-imagine-video/scripts/client.py"

& $PYTHON_BIN $CLI_PATH --video \
  --prompt "A sleek futuristic sports car speeding along a rain-slicked highway in a cyberpunk metropolis at night, neon reflections on asphalt, dynamic tracking shot, cinematic lighting, 8k, hyperrealistic." \
  --duration 3.0 --aspect-ratio "16:9" --steps 10 --json
```
