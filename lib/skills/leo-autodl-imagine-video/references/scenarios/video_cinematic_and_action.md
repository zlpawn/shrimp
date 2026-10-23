# 场景指南 3：高清去油腻电影流、高动态武戏与台词文戏进阶调优

当用户在首轮 `minimax_h3_video_1pass_api.json` 生成后，希望**进一步提升画质清晰度、消除塑料油腻感、挂载电影感 LoRA，或针对武戏打斗/文戏台词做专项强化**时，使用本指南中的进阶工作流与调优方案。

* **对应成熟工作流模板**：[minimax_h3_video_cinematic_lora_api.json](../workflows/minimax_h3_video_cinematic_lora_api.json)
* **远端同源进阶流参考**：
  * `U17-MiniMax-H3-latent放大模型双采加速-高动态不糊-去油腻-修音频-全能工作流.json`
  * `U18-MiniMax-H3-Remix-FeiHou-Easy-H3-二次采样工作流v2.json`
  * `U34-WORK-FISHER-9-28-MINIMAXH3-武戏高动态工作流.json`
  * `U35-H3官流-单采文戏-神棍.json` / `U35-H3官流-最强武戏-神棍.json`

---

## 1. 高清去油腻电影感工作流 (`minimax_h3_video_cinematic_lora_api.json`)

相比基础 1-pass 流，`minimax_h3_video_cinematic_lora_api.json` 做了以下 **6 项核心画质升级**：

1. **主模型升级为 FeiHou 高清微调版**（Node `141`）：
   * `minimax/FeiHou_MiniMax-H3_Remix_HSA_turbo_v0.8_int8_convrotHQ_pruned.safetensors`，专门去除原生 H3 的油腻感并强化电影级反差。
2. **串联电影感专属 LoRA 节点**（新增 Node `160` `LoraLoaderModelOnly`）：
   * 挂载 `minimax/电影感H3-loraV1.0正式版_剪枝与非剪枝通用.safetensors`（默认强度 `0.75`），连接在 `141` (`DiffusionModelLoaderKJ`) 与 `174` (`EasyCache`) 之间。
3. **VAE 升级为 2 倍细节强化版**（Node `119`）：
   * 使用 `MiniMax-H3-X2-Detail-v1.safetensors` 替代基础 `fp16` VAE，发丝、衣物纹理、背景建筑锐度大幅提升。
4. **文本编码器升级为 INT8 高精版**（Node `128`）：
   * 使用 `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`。
5. **大幅收紧 EasyCache 阈值 + 提升步数**（Node `174` & `124`）：
   * `reuse_threshold` 从 `0.3` 降至 `0.1`，采样步数从 `10` 提升至 `16` 步，消除运动模糊。
6. **画幅像素与压制码率提升**（Node `115` & `142`）：
   * `megapixels` 提升至 `1.0`，`ref_image_size` 设为 `"max"`，H.264 压制质量 `crf` 设为 `17`。

### 一键调用方式：
```bash
& $PYTHON_BIN $CLI_PATH --video \
  --workflow "minimax_h3_video_cinematic_lora_api.json" \
  --prompt "电影级特写镜头，黄昏夕阳透过百叶窗洒在木质书桌上，空气中微尘漂浮，一位身穿复古西装的男人缓缓端起咖啡杯，眼神深邃。35mm胶片颗粒质感。Audio direction: 轻柔的大提琴背景音乐，衣料摩擦的细微声响，陶瓷杯放下的清脆声。" \
  --duration 5.0 --aspect-ratio "16:9" --steps 16 --crf 17 --json
```

---

## 2. 专项子场景调优配方（武戏 vs 文戏 vs 首尾帧）

Agent 可在 `minimax_h3_video_cinematic_lora_api.json` 基础上，通过参数或 `--patch` 一键切换专项子场景：

### 2.1 高动态武戏 / 追逐打斗配方（防残影、大动态）
* **切换主模型**：`--diffusion-model "minimax/DasiwaMinimaxH3_dasiwaHybrid8turboV1.safetensors"`
* **调低缓存防粘连**：`--patch "174.inputs.reuse_threshold=0.05"`
* **调整 LoRA 强度**：`--patch "160.inputs.strength_model=0.5"`（避免胶片 LoRA 限制大动作幅度）
* **采样步数**：`--steps 12`

### 2.2 细腻文戏 / 台词对白配方（稳五官、准口型）
* **切换主模型**：`--diffusion-model "minimax/Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors"`
* **开启最高参考图保真**：`--ref-image-size max`
* **采样步数**：`--steps 14`

### 2.3 首尾帧过渡配方 (`fl2va`)
* **切换主模型**：`--diffusion-model "minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors"`
* **传入首帧与尾帧图片**：`--ref-images "first_frame.png,last_frame.png"`

---

## 3. 如何从远端拉取二采/三采工作流继续沉淀？

如果遇到超长镜头或极致 1080P 超分需求，Agent 可以随时把 AutoDL 远端内置的二采工作流拉取下来：
```bash
# 拉取 VRGDG 官方潜空间超分二采 API 工作流模板
& $PYTHON_BIN $CLI_PATH --fetch-remote-workflow "/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_audio_driven_builder_latent_upscale_2pass_api.json" \
  --save-to "lib/skills/leo-autodl-imagine-video/references/workflows/minimax_h3_video_2pass_latent_upscale_api.json"
```
拉取后即可通过 `--run-workflow minimax_h3_video_2pass_latent_upscale_api.json` 执行，并将调优心得补充到 `references/scenarios/` 目录下。
