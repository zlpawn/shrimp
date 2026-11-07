# MiniMax-H3 已验证工作流拓扑、核心节点 Schema 与调优指南

本文档整合了已在云端 **RTX 5090 (32GB)** 上真机实测跑通的生图与生视频工作流节点拓扑、核心节点 `/object_info` 定义，以及工作流动态调优流程。

---

## 1. 已验证的 9 节点生图工作流 (`minimax_h3_image_u33_api.json`)

提炼自 `U33-Minimax-H3图像编辑全能工作流.json`，通过将 `MiniMaxH3ReferenceToVideo` 的 `length` 设为最小值 `5` 并截取首帧实现静态图像生成：

| 节点 ID | 节点类型 (`class_type`) | 实测参数配置 | 说明 |
| :--- | :--- | :--- | :--- |
| **`"1"`** | `DiffusionModelLoaderKJ` | `model_name`: `"minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"`<br/>`sage_attention`: `"auto"`, `enable_fp16_accumulation`: `true` | 加载 MiniMax-H3 扩散模型 |
| **`"2"`** | `CLIPLoader` | `clip_name`: `"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"`, `type`: `"minimax"` | 加载 Qwen3-VL 32B 编码器 |
| **`"3"`** | `VAELoader` | `vae_name`: `"minimax_h3_video_vae_fp16.safetensors"` | 加载 MiniMax-H3 视频 VAE |
| **`"4"`** | `MiniMaxH3ReferenceToVideo` | `clip`: `["2", 0]`, `vae`: `["3", 0]`, `prompt`: `<提示词>`<br/>`width`: `1280`, `height`: `736`, **`length`: `5`**, `ref_image_size`: `"match"` | 帧长 `length=5` 用于生成静态图（5宫格分镜板可设 `2048x2048`, `ref_image_size="max"`） |
| **`"5"`** | `ConditioningZeroOut` | `conditioning`: `["4", 0]` | 正向条件置零作为 `negative` 输入 |
| **`"6"`** | `KSampler` | `steps`: `10~12`, `cfg`: `1.0`, `sampler_name`: `"euler"`, `scheduler`: `"beta"`, `denoise`: `1.0` | 执行去噪采样 |
| **`"7"`** | `VAEDecode` | `samples`: `["6", 0]`, `vae`: `["3", 0]` | 解码潜变量为图像帧批次 |
| **`"8"`** | `ImageFromBatch` | `image`: `["7", 0]`, `batch_index`: `0`, `length`: `1` | 提取第 1 张单帧图像 |
| **`"9"`** | `SaveImage` | `images`: `["8", 0]`, `filename_prefix`: `"MiniMaxH3_Image"` | 保存 PNG 到 `/root/ComfyUI/output/` |

---

## 2. 已验证的 15 节点音画同步生视频工作流 (`minimax_h3_video_1pass_api.json`)

源自 `minimax_built_in_audio_builder_api.json`（修正了节点 `141` 的 `minimax/` 模型子目录前缀），在 RTX 5090 上 3 秒视频（`steps=10`）采样耗时约 19 秒：

| 节点 ID | 节点类型 (`class_type`) | 实测参数配置 | 说明 |
| :--- | :--- | :--- | :--- |
| **`"115"`** | `ResolutionSelector` | `aspect_ratio`: `"16:9 (Widescreen)"`, `megapixels`: `0.9`, `multiple`: `32` | 自动计算 32 倍数对齐宽高（`0.9 MP` 在 `16:9` 下为 `1280x736`） |
| **`"141"`** | `DiffusionModelLoaderKJ` | `model_name`: `"minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"` | 加载 MiniMax-H3 扩散主模型 |
| **`"174"`** | `EasyCache` | `reuse_threshold`: `0.3`, `start_percent`: `0.2`, `end_percent`: `0.9`, `model`: `["141", 0]` | 采样特征缓存加速（调小 `reuse_threshold` 可提升清晰度） |
| **`"128"`** | `CLIPLoader` | `clip_name`: `"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"`, `type`: `"minimax"` | 加载 Qwen3-VL 32B 编码器 |
| **`"119"` / `"120"`** | `VAELoader` | `minimax_h3_video_vae_fp16.safetensors` / `minimax_h3_audio_vae_fp32.safetensors` | 分别加载视频 VAE 与音频 VAE |
| **`"132"` / `"131"`** | `PrimitiveFloat` / `ComfyMathExpression` | `expression`: `"max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17"` | 将目标秒数按 24fps 换算为满足 $17n+5$ 约束的合法帧数 `length` |
| **`"138"`** | `PrimitiveStringMultiline` | `value`: `<提示词>` | 输入包含画面、运镜、台词与声音指示的提示词 |
| **`"180"`** | `VRGDG_MiniMaxH3ReferenceMediaFromPaths` | `image_paths`: `"[]"`, `video_references`: `"[]"` | 自动绑定最多 9 张参考图与 3 段参考视频 |
| **`"136"`** | `MiniMaxH3ReferenceToVideo` | 连接 `138`, `115`, `131`, `128`, `119`, `120`, `180`, `ref_image_size`: `"match"` | 构建音视频联合 Conditioning 与初始 Latent |
| **`"129"`** | `RandomNoise` | `noise_seed`: `<随机种子>` | 随机噪声种子 |
| **`"123"~"126"`** | `KSamplerSelect` / `BasicScheduler` / `BasicGuider` / `SamplerCustomAdvanced` | `sampler_name`: `"res_multistep"`, `scheduler`: `"simple"`, `steps`: `10` | 音视频联合去噪采样 |
| **`"121"` / `"122"`** | `LTXVAudioVAEDecode` / `VAEDecode` | 分别解码出音频波形与视频画面序列 | 音画分离解码 |
| **`"142"`** | `VHS_VideoCombine` | `frame_rate`: `24`, `format`: `"video/h264-mp4"`, `pix_fmt`: `"yuv420p"`, `crf`: `19` | 封装合并为带音轨的 `.mp4` 文件 |

---

## 3. `MiniMaxH3ReferenceToVideo` 节点核心参数规范 (`GET /object_info`)

* **`width` / `height`**：范围 `32 ~ 16384`，步长必须为 `32` 的倍数。
* **`length`**：最小值 `5`，步长 `17`（合法帧数必须满足 $17n + 5$；生图取 `5`，生视频按 24fps 向上取整至最近的 $17n+5$）。实际时长因此可能比 `--duration` 长（7.0 秒 → 175 帧 = 7.29 秒），排时间轴按实际时长。
* **`ref_image_size`**：
  * `"match"`（默认）：将参考图缩放至匹配输出画幅面积，显存占用低、速度快；
  * `"max"`：使用 2048px 短边保留最高人物/细节保真度，适合高清分镜板或多图精修。
* **完整可用底模、CLIP 与 LoRA 清单（含 `adaln` 剪枝/完整兼容标记）**：请查阅 [minimax_h3_models_and_loras.json](prompts_and_guides/minimax_h3_models_and_loras.json)。

---

## 4. 动态微调与使用进阶工作流的方法

1. **在基准工作流上微调参数 (`--patch`)**：
   * 调整步数 `--steps`（如 `10 -> 16`）；
   * 调整 `EasyCache` 阈值：`--patch "174.inputs.reuse_threshold=0.08"`（彻底压低缓存复用，锁死发丝与微表情高频细节）；
   * 提升原生分辨率：`--megapixels 1.1` 或 `1.2`；
   * 近无损色彩压制：`--crf 17`；
   * 切换底模或 LoRA（需对照 [minimax_h3_models_and_loras.json](prompts_and_guides/minimax_h3_models_and_loras.json) 中的 `adaln` 兼容性）。
2. **按场景选用 `references/workflows/u_series_api/` 下的备用工作流**：
   * 可先查阅 [U视频-MINIMAX-H3_工作流说明.md](prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md) 了解 `U00~U37` 各工作流定位；
   * 查看对应 `API-U*.json` 底部的 `_api_config` 了解可调参数槽位（如 `"139:prompt"`），并通过 `--run-workflow "API-U03-..." --patch "139:prompt=..."` 提交远端运行。

---

## 5. 🏆 ComfyUI 50+ 工作流场景能力图谱与选型矩阵（效果优先指南）

Agent **必须根据分镜的视听特征与成品画质要求自主推理，动态匹配最佳工作流**，严禁死板套用单一模板：

| 分镜场景特征 | 推荐最佳工作流 | 画质原理与关键技术栈 | 适用镜头类型 |
| :--- | :--- | :--- | :--- |
| **微表情对白 / 极致光影 / 电影感质感** | `minimax_audio_driven_builder_latent_upscale_2pass_api.json`<br/>`API-U30.json` | **2-Pass 潜空间放大超分**：一采出基础构图与动态，二采利用 Latent Upscale + 真实高斯噪声注入毛孔级皮肤纹理、眼眶微光与织物褶皱，彻底消除 AI 视频的塑料平滑感。 | 近景对白、心理交锋、领奖致辞、情感高潮 |
| **疾驰奔跑 / 剧烈运动 / 武戏打斗** | `API-U24-文武双修T8版.json`<br/>`API-U08.json` | **Combat / Motion Repair LoRA 链**：专门优化大范围肢体位移与高速运动，解决常规模型在大动作时容易产生的肢体拉丝、面部扭曲崩塌与残影问题。 | 公路夜奔、策马疾驰、体育竞技、动作打斗 |
| **多角色 / 多服装跨镜头严格一致** | `API-U01-minimax_h3_基础版API.json`<br/>`API-U06-9图版API-V5.json`<br/>`API-U22-9图3音.json` | **9 图多模态多参考绑定**：支持上传 3~9 张角色、服装、道具三视图参考图，通过 `MiniMaxH3ReferenceToVideo` 多图像槽位对齐身份与特征。 | 固定主角短剧、商业广告角色、品牌服装展示 |
| **纯音频驱动 / 严丝合缝说话对口型** | `API-U11-Minimax-图片音频对口型API.json`<br/>`minimax_audio_driven_builder_api.json` | **Audio-driven Lip-sync**：以真实音轨作为核心 Conditioning 驱动源，强制嘴唇几何形态跟随音素运动，避免出现画面张嘴声音不对齐的“假唱感”。 | 播客对话、严肃口播、新闻宣讲 |
| **电影长镜头顺接 / 段落色彩无缝对齐** | `API-U43.json`<br/>`API-U02-minimax_h3_图生视频基础版-V2.json` | **首尾帧插值与时序上下文传递**：将前一段镜头的最后一帧或关键定妆图作为起始锚点，并执行偏色自动校准，确保镜头切换时色彩与光照不跳帧。 | 长运镜穿越、时空流转、叙事段落平滑转场 |
| **构图快速验证 / 语法试跑** | `minimax_h3_video_1pass_api.json` | **1-Pass 单通道极速采样**：10 步采样仅需 19 秒，用于低成本验证提示词是否跑通、运镜方向是否正确。 | 草稿预览、构图试验、快速验证 |
