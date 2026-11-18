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

## 2. 双默认高保真音画同步生视频工作流 (`API-U02` 首尾帧锁死 + `API-U06` 多图参考)

已废除早期的低步数 `EasyCache=0.3` 单通道草稿模板，`--video` 现默认按参考素材自动分流至以下两套高精度工作流（均内置 `H3SigmaRefiner` 尾段余弦细节增强与显存自动回收）：

### 2.1 默认主工作流：`API-U02-minimax_h3_图生视频基础版-V2.json`（`i2v` / `fl2v` / `t2v`）
- **核心底模与节点**：`minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors` + `MiniMaxH3ImageToVideo`（节点 `139`）+ `H3SigmaRefiner`（节点 `149`，25+2 步，无 `EasyCache` 模糊劣化）。
- **自动帧绑定逻辑**：
  - 传入 **1 张分镜图**：自动写入节点 `114` (`first_frame`) 并移除节点 `144` (`last_frame`)，100% 锁死开场构图与人物五官；
  - 传入 **2 张分镜图**：分别绑定 `114` (`first_frame`) 与 `144` (`last_frame`)，将大幅转身或位移两头钉死；
  - 传入 **0 张图**：自动清理示例 `LoadImage` 节点，作为纯净 25+2 步文生视频运行。

### 2.2 默认多图参考流：`API-U06-9图版API-V5.json`（`r2v`，3～9 张参考图或显式 `--mode r2v`）
- **核心底模与节点**：`minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors` + `MiniMaxH3ReferenceToVideo`（节点 `136`，默认 `ref_image_size="max"` 2048px 高保真）+ `H3SigmaRefiner`（22+2 步，默认 `718.inputs.select=1` 走无 Turbo 满步高精分支）。
- **动态注入机制**：引擎自动清理模板内写死的示例 `LoadImage` 节点，动态挂载 `VRGDG_MiniMaxH3ReferenceMediaFromPaths` 绑定任意 1～9 张参考图与 0～3 段参考视频。

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
| **电影长镜头顺接 / 首尾帧严格锁死（默认主力）** | `API-U02-minimax_h3_图生视频基础版-V2.json`<br/>`API-U43.json` | **FL2VA 首尾帧插值与时序锚定**：将宫格切出的分镜首帧或上一段末帧作为起始硬锚点，配合 `H3SigmaRefiner` 25+2 步精修，根治跨视频换脸。 | 分镜图驱动生视频、姿态转换、叙事段落平滑转场 |
