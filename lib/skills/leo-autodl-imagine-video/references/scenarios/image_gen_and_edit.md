# 场景指南 1：MiniMax-H3 生图与 `U33` 图像工作流实测记录

本文档记录了从云端 `/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/U33-Minimax-H3图像编辑全能工作流.json` 提炼并在 RTX 5090 上**真机实测跑通**的 MiniMax-H3 生图工作流。

* **已验证 API 工作流模板**：[minimax_h3_image_u33_api.json](../workflows/minimax_h3_image_u33_api.json)

---

## 1. 已上机验证的 9 节点生图拓扑 (`minimax_h3_image_u33_api.json`)

在云端 RTX 5090 实测：提交以下 9 节点工作流至 `POST http://127.0.0.1:6006/prompt`，成功生成 `1280x736` 分辨率的 PNG 图像（`MiniMaxH3_Image_00001_.png`）：

| 节点 ID | 节点类型 (`class_type`) | 实测参数配置 | 说明 |
| :--- | :--- | :--- | :--- |
| **`"1"`** | `DiffusionModelLoaderKJ` | `model_name`: `"minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"`<br/>`sage_attention`: `"auto"`, `enable_fp16_accumulation`: `true` | 加载 MiniMax-H3 扩散模型（原版 `U33` 中也可使用 `UNETLoader` 加载 `minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`） |
| **`"2"`** | `CLIPLoader` | `clip_name`: `"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"`<br/>`type`: `"minimax"`, `device`: `"default"` | 加载 Qwen3-VL 32B 编码器（原版 `U33` 使用 `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`） |
| **`"3"`** | `VAELoader` | `vae_name`: `"minimax_h3_video_vae_fp16.safetensors"` | 加载 MiniMax-H3 视频 VAE |
| **`"4"`** | `MiniMaxH3ReferenceToVideo` | `clip`: `["2", 0]`, `vae`: `["3", 0]`<br/>`prompt`: `<提示词>`, `width`: `1280`, `height`: `736`<br/>**`length`: `5`**, `ref_image_size`: `"match"` | 将帧长 `length` 设为最小值 `5`，用于生成静态图 |
| **`"5"`** | `ConditioningZeroOut` | `conditioning`: `["4", 0]` | 将正向条件置零作为 `KSampler` 的 `negative` 输入（来自原版 `U33` 节点 `63/191`） |
| **`"6"`** | `KSampler` | `model`: `["1", 0]`, `positive`: `["4", 0]`, `negative`: `["5", 0]`, `latent_image`: `["4", 1]`<br/>`steps`: `10~12`, `cfg`: `1.0`, `sampler_name`: `"euler"`, `scheduler`: `"beta"`, `denoise`: `1.0` | 原版 `U33`（节点 `45/189`）使用的采样器参数：`euler` + `beta` + `cfg=1.0` |
| **`"7"`** | `VAEDecode` | `samples`: `["6", 0]`, `vae`: `["3", 0]` | 解码潜变量为图像帧批次 |
| **`"8"`** | `ImageFromBatch` | `image`: `["7", 0]`, `batch_index`: `0`, `length`: `1` | 从解码后的批次中提取第 1 张单帧图像 |
| **`"9"`** | `SaveImage` | `images`: `["8", 0]`, `filename_prefix`: `"MiniMaxH3_Image"` | 保存单张 PNG 到 `/root/ComfyUI/output/` |

---

## 2. 实测命令示例

```bash
PYTHON_BIN="$HOME/.shrimp/skills/leo-autodl-imagine-video/.venv/Scripts/python.exe"
CLI_PATH="lib/skills/leo-autodl-imagine-video/scripts/client.py"

& $PYTHON_BIN $CLI_PATH --image \
  --prompt "A cinematic close-up portrait of a cyberpunk girl in neon rain, glowing blue eyes, 8k photorealistic masterpiece" \
  --width 1280 --height 736 --steps 12 --json
```

---

## 3. 原版 `U33` 中已读取发现但尚未转成 API 实测的高阶特性（待后续按需验证）

通过读取远端 `U33-Minimax-H3图像编辑全能工作流.json` 的节点列表，原工作流还包含以下设计（目前尚未在 API 模式下跑图实测，后续其他 Agent 如需使用请先在真机测试）：
1. **多参考图加载与缩放方式**：
   * 原版 `U33` 使用 `LoadImage`（节点 `91, 93, 94, 101, 102, 104, 116, 117`）配合 `LayerUtility: ImageScaleByAspectRatio V2`（节点 `161~168`，缩放到 `1280` 千像素、对齐 `32`），再连入 `MiniMaxH3ReferenceToVideo`（节点 `77`）的 `ref_images.ref_image_0 ~ 7`。
2. **2048x2048 5 宫格电影分镜板**：
   * 原版 `U33` 节点 `77` 与 `187` 的默认宽高设为 `2048 x 2048`，`length: 5`，`ref_image_size: "max"`，节点 `202` (`CR Prompt Text`) 内置了完整的“5宫格电影剧照分镜板（上排2格，中排1格，下排2格）”提示词模板。
