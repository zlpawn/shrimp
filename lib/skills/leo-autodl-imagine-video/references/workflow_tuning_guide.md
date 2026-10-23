# MiniMax-H3 节点Schema、云端模型真实清单与工作流探索方法

本文档严格基于远端 ComfyUI `GET /object_info` 的真实返回数据整理，列出已验证的核心节点 Schema、云端客观存在的 MiniMax-H3 模型权重清单，以及 Agent 动态探索与调整工作流的标准方法。

---

## 1. 已验证的 MiniMax-H3 核心节点 Schema (`GET /object_info`)

### 1.1 `MiniMaxH3ReferenceToVideo`（生图与生视频核心条件节点）
从远端 `GET /object_info/MiniMaxH3ReferenceToVideo` 抓取的真实输入定义：
* **必填输入 (`required`)**：
  * `clip` (`CLIP`)：连接 `CLIPLoader` 输出（`type` 必须为 `"minimax"`）。
  * `prompt` (`STRING`, multiline)：提示词文本。
  * `width` (`INT`)：默认 `1344`，范围 `32 ~ 16384`，步长 `32`。
  * `height` (`INT`)：默认 `768`，范围 `32 ~ 16384`，步长 `32`。
  * `length` (`INT`)：默认 `124`（24fps 下约 5s），**最小值 `5`，步长 `17`（即合法帧数必须满足 $17n + 5$）**。
    * **生图模式**：设为最小值 `5`（解码后取第 1 帧即为单张静帧图像）。
    * **生视频模式**：由公式 `max(5, round(seconds * 24)) + (5 - (max(5, round(seconds * 24)) % 17)) % 17` 计算。
  * `ref_image_size` (`COMBO`)：枚举值 `["match", "max"]`，默认 `"match"`。
    * 官方 Tooltip 说明：`"match"` 将参考图按比例缩小至生成画面的像素面积；`"max"` 使用参考管线的 2048px 短边以获得最佳身份保真度（但每个采样步都会携带参考 Token，速度会变慢）。
* **可选输入 (`optional`)**：
  * `vae` (`VAE`)：视频 VAE。
  * `audio_vae` (`VAE`)：音频 VAE（仅生视频需要，生图可不接）。
  * `ref_images.ref_image_0` ~ `ref_images.ref_image_8` (`IMAGE`)：最多 9 张参考图。
  * `ref_videos.ref_video_0` ~ `ref_videos.ref_video_2` (`IMAGE`)：最多 3 段参考视频。
* **输出 (`output`)**：
  * 槽位 `0`：`positive` (`CONDITIONING`)
  * 槽位 `1`：`LATENT` (`LATENT`)

---

## 2. 云端 `/object_info` 实测存在的 MiniMax-H3 模型文件清单

以下文件名全部直接提取自远端 ComfyUI `/object_info` 返回的枚举数组（零臆造）：

### 2.1 已上机实测跑通的默认权重组合
* **扩散主模型 (`DiffusionModelLoaderKJ`)**：`minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors`（已在生图与生视频中实测跑通）
* **原版 `U33` 生图流中使用的主模型 (`UNETLoader`)**：`minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`
* **文本编码器 (`CLIPLoader`, `type="minimax"`)**：
  * `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`（已在生图与生视频中实测跑通）
  * `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`（原版 `U33` 中配置的编码器）
* **VAE (`VAELoader`)**：
  * 视频/图像 VAE：`minimax_h3_video_vae_fp16.safetensors`（已实测跑通）
  * 音频 VAE：`minimax_h3_audio_vae_fp32.safetensors`（已实测跑通）

### 2.2 云端存在、可供后续测试探索的其他 `minimax/*` 模型（尚未逐一上机跑图验证）
* **`DiffusionModelLoaderKJ` 中的其他 `minimax/` 模型**：
  * `minimax/minimax_h3_ref2va_bf16.safetensors`
  * `minimax/minimax_h3_ref2va_int8_convrot.safetensors`
  * `minimax/minimax_h3_ref2va_pruned_bf16.safetensors`
  * `minimax/minimax_h3_ref2va_pruned_fp8_scaled.safetensors`
  * `minimax/minimax_h3_ref2va_pruned_nvfp4.safetensors`
  * `minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors`
  * `minimax/fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors`
  * `minimax/FeiHou_MiniMax-H3_Remix_HSA_turbo_v0.8_int8_convrotHQ.safetensors`
  * `minimax/FeiHou_MiniMax-H3_Remix_HSA_turbo_v0.8_int8_convrotHQ_pruned.safetensors`
  * `minimax/DasiwaMinimaxH3_dasiwaHybrid8turboV1.safetensors`
  * `minimax/Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors`
* **`LoraLoader` 中的 `minimax/` 相关 LoRA**：
  * `minimax/电影感H3-loraV1.0正式版.safetensors`
  * `minimax/电影感H3-loraV1.0正式版_剪枝与非剪枝通用.safetensors`

---

## 3. Agent 探索与调优工作流的标准流程（严禁盲目拼凑）

当现有的两个已验证工作流（`minimax_h3_image_u33_api.json` 与 `minimax_h3_video_1pass_api.json`）不能满足用户需求，需要调优或引入新工作流时，Agent **必须遵循以下实证步骤**：

1. **第一优先级：在已验证工作流上微调已知参数 (`--patch`)**
   * 修改采样步数 `--steps`（如从 `10` 调至 `15~20`）；
   * 修改 `EasyCache`（节点 `174`）的 `reuse_threshold`（默认 `0.3`，调小可减少跳步缓存带来的模糊）；
   * 修改 `MiniMaxH3ReferenceToVideo` 的 `ref_image_size`（`"match"` 或 `"max"`）。
2. **第二优先级：从远端拉取现成的成熟工作流原文件研究 (`--fetch-remote-workflow`)**
   * 若需二采放大、武戏、文戏或复杂多图编辑，先从 `/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/` 或 `/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/` 下载原文件：
     ```bash
     & $PYTHON_BIN $CLI_PATH --fetch-remote-workflow "/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_audio_driven_builder_latent_upscale_2pass_api.json"
     ```
   * 阅读下载下来的真实 JSON 节点连线与参数，必要时用 `--inspect-node <NodeClass>` 检查节点定义。
3. **第三优先级：真机实测通过后再沉淀**
   * 用 `--run-workflow` 在云端实例上实际跑通、确认不报错且画质符合预期后，再将验证过的 JSON 存入 `references/workflows/` 并更新 `references/scenarios/`。
