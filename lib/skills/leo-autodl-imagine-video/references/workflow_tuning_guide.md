# MiniMax-H3 工作流构建与画质调优总纲 (Workflow Building & Tuning Guide)

本文档指导 Agent 理解 **MiniMax-H3 在 ComfyUI 中的核心节点架构、可用模型资产，以及当用户对初版生图/生视频效果不满意时，如何动态调整节点参数或重组工作流 JSON**。

> **可持续演进原则**：本指南与 `references/scenarios/`、`references/workflows/` 是活的知识库。当 Agent 在调优过程中验证出效果极佳的新节点组合或从远端 `U00~U43` 提炼出新的 API 工作流时，应将其保存至 `references/workflows/` 并在 `references/scenarios/` 中补充对应场景文档。

---

## 1. MiniMax-H3 核心组件选型表（云端 100TB 共享盘实测可用）

可通过 `--list-models` 实时查询，核心可替换组件如下：

### 1.1 扩散主模型 (`DiffusionModelLoaderKJ` $\to$ `inputs.model_name`)

| 模型路径 | 定位与优势 | 适用场景 | 推荐 `steps` |
| :--- | :--- | :--- | :--- |
| `minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors` | **官方基准全能版（默认）**。支持文生/多图参考生视频与生图，INT8 量化均衡稳定 | 日常文生图、文生视频、单/多参考图视频初稿 | 视频 `10~15`<br/>生图 `12` |
| `minimax/FeiHou_MiniMax-H3_Remix_HSA_turbo_v0.8_int8_convrotHQ_pruned.safetensors` | **FeiHou 高清光影微调版**。皮肤纹理细腻、去除原生塑料感、电影光影极佳 | **人物特写、写实剧情片、对画质要求高的视频/图片** | `12 ~ 16` |
| `minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors` | **FL2VA+REF2VA 混合增强版**（`U33` 生图流御用底模）。空间结构与多图融合极强 | **多参考图角色换装、多人同框、2048x2048 电影分镜板生图** | `12 ~ 15` |
| `minimax/DasiwaMinimaxH3_dasiwaHybrid8turboV1.safetensors` | **Dasiwa 8 步高动态版**。运动幅度大，光影对比强烈 | **武戏打斗、飙车追逐、大运镜动作场面** | `8 ~ 10` |
| `minimax/Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors` | **Singularity 特异点文戏版**。面部表情稳定、口型与肢体微动作自然 | **人物对话文戏、情感特写、数字人说话** | `10 ~ 14` |
| `minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors` | **首尾帧专用版 (`fl2va`)** | 给定首帧与尾帧生成精确镜头过渡 | `12 ~ 15` |
| `minimax/fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors` | **8 步极速蒸馏版** | 快速验证分镜构图与台词节奏 | `6 ~ 8` |

### 1.2 多模态文本编码器 (`CLIPLoader` $\to$ `inputs.clip_name`, `type: "minimax"`)

| 编码器路径 | 特点与切换时机 |
| :--- | :--- |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | **默认首选**。4-bit AWQ 量化，加载快、显存占用低，日常生图生视频足够精准 |
| `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | **高精理解版**。当 Prompt 包含极其复杂的**多格分镜排版**或 **5~9 张参考图严格位置绑定**时切换至此模型 |
| `qwen3vl_32b_minimax_h3_int8_convrot_uncensored_FeiHou.safetensors` | **FeiHou 无限制高精版**。配合 FeiHou 主模型使用，语义遵循度极高 |

### 1.3 视频与图像 VAE (`VAELoader` $\to$ `inputs.vae_name`)

| VAE 路径 | 特点与切换时机 |
| :--- | :--- |
| `minimax_h3_video_vae_fp16.safetensors` | **官方标准 FP16 视频/图像 VAE（默认）** |
| `MiniMax-H3-X2-Detail-v1.safetensors` | **细节强化 VAE**。解码时显著增强发丝、织物与皮肤微纹理，觉得画面偏肉/不够锐利时直接替换 `vae_name`！ |
| `minimax_h3_audio_vae_fp32.safetensors` | **官方 FP32 音频 VAE**（专用于音频解码节点 `120`） |

### 1.4 专属 LoRA (`LoraLoaderModelOnly` $\to$ `inputs.lora_name`)

| LoRA 路径 | 推荐强度 (`strength_model`) | 作用 |
| :--- | :--- | :--- |
| `minimax/电影感H3-loraV1.0正式版_剪枝与非剪枝通用.safetensors` | `0.65 ~ 0.85` | 显著提升电影胶片颗粒感、冷暖光影层次与景深质感（已内置在 `minimax_h3_video_cinematic_lora_api.json` 节点 `160`） |

---

## 2. 问题诊断与定向调优处方（当用户对效果不满意时怎么调？）

当用户查看首轮生成的图片或视频后提出意见，Agent 切勿盲目重跑相同配置，应按以下处方通过 `--workflow` 或 `--patch` 精准调优：

### 处方 1：用户反馈“视频画面有点糊 / 皮肤有油腻感 / 细节不够锐利”
* **根因**：默认 1-pass 工作流为了速度开启了 `EasyCache (reuse_threshold=0.3)` 且仅采样 10 步，高频纹理被缓存跳步平滑掉了。
* **调优动作**：
  1. **直接切换至电影感高清工作流**：使用 `--workflow minimax_h3_video_cinematic_lora_api.json`（已默认搭载 `FeiHou` 高清底模 + `电影感H3 LoRA` + `MiniMax-H3-X2-Detail-v1 VAE` + `EasyCache=0.1` + `16步` + `1.0 MP`）。
  2. **或者在当前工作流上打补丁 (`--patch`)**：
     ```bash
     --patch "141.inputs.model_name=minimax/FeiHou_MiniMax-H3_Remix_HSA_turbo_v0.8_int8_convrotHQ_pruned.safetensors" \
     --patch "119.inputs.vae_name=MiniMax-H3-X2-Detail-v1.safetensors" \
     --patch "174.inputs.reuse_threshold=0.08" \
     --steps 16 --megapixels 1.0 --crf 17
     ```

### 处方 2：用户反馈“用了参考图，但生成出来的人脸不够像 / 衣服细节变了”
* **根因**：
  1. `MiniMaxH3ReferenceToVideo` 的 `ref_image_size` 默认是 `"match"`（会把参考图缩小到输出画面同尺寸）；
  2. Prompt 中没有显式绑定 `<Picture 1>` 身份锚点。
* **调优动作**：
  1. 将 `--ref-image-size` 设为 **`max`**（启用 2048px 短边最高身份保真通道）；
  2. 将编码器切换为 `int8` 高精版：`--clip-model "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"`；
  3. 在 Prompt 开头显式声明参考图绑定关系（详见场景指南 `scenarios/image_gen_and_edit.md`）：
     > `Image 1 (角色参考): 严格保留图1人物的面部五官、发型与服装配饰不变，仅参考样貌不参考原图姿势。画面中该角色正在...`

### 处方 3：用户反馈“打斗/运动场面动作太小、慢吞吞，或者大动作时肢体崩坏”
* **调优动作**：
  1. 切换主模型为高动态武戏专调版：`--diffusion-model "minimax/DasiwaMinimaxH3_dasiwaHybrid8turboV1.safetensors"`；
  2. 降低 `EasyCache` 复用阈值（`--patch "174.inputs.reuse_threshold=0.05"`），防止大幅度位移时残影粘连；
  3. 若需极致武戏工作流，可通过 `--fetch-remote-workflow "/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/U34-WORK-FISHER-9-28-MINIMAXH3-武戏高动态工作流.json"` 拉取远端武戏专流分析节点参数。

### 处方 4：用户反馈“声音/台词没出来，或者背景音乐太吵盖过了人声”
* **调优动作**：
  * MiniMax-H3 的音轨由 `MiniMaxH3ReferenceToVideo` 根据 Prompt 中的声音描述联合生成。
  * 在 Prompt 末尾加入独立明确的 **`Audio direction:`** 段落，明确区分前景人声与环境拟音，例如：
    > `Audio direction: Clear, close-mic female voice speaking calmly in Mandarin: "好久不见。" Subtle rain pattering in the background, no background music.`

---

## 3. Agent 如何自己组装或修改 ComfyUI 工作流 JSON？

本技能的 `client.py` 提供了完全开放的节点自省与 JSON 执行能力，Agent 可按以下三步自由修改或新建工作流：

1. **查节点定义 (`--inspect-node`)**：
   不确定某个节点叫什么或有哪些输入参数时，执行：
   ```bash
   & $PYTHON_BIN $CLI_PATH --inspect-node LoraLoaderModelOnly --json
   & $PYTHON_BIN $CLI_PATH --inspect-node MiniMaxH3ReferenceToVideo --json
   ```
2. **改节点属性或新增节点 (`--patch` 或直接编辑 JSON)**：
   * **轻量微调**：直接用 `--patch "节点ID.inputs.字段名=新值"`（支持多次传入 `--patch`）。
   * **结构性改造**（如新增二采超分节点、串联多个 LoRA）：读取 `references/workflows/` 下的基准 JSON，构造新的节点字典保存为新 JSON 文件，然后调用：
     ```bash
     & $PYTHON_BIN $CLI_PATH --run-workflow "my_custom_workflow.json" --ref-images "ref1.png" --json
     ```
3. **沉淀优秀配方**：
   一旦某个自定义工作流在用户任务中取得了惊艳效果，将其正式放入 `references/workflows/`，并在 `references/scenarios/` 下记录其适用场景与参数要点，实现技能自我进化。
