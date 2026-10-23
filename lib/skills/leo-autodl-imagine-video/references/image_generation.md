# 图片生成真实 API 与双引擎工作流全解 (Image Generation API Reference)

本文档完整沉淀了 `leo-autodl-imagine-video` 在云端 ComfyUI 执行图片生成的**双引擎（`sdxl` 与 `minimax_h3`）真实 API 规范**：
1. **Agent 高阶调用接口**（Python SDK 与 CLI 参数规范，支持 `sdxl` 极速底模引擎与 `minimax_h3` 多参考图/电影分镜引擎）
2. **远端 ComfyUI HTTP REST 通信协议**（提交、轮询、内省与 SFTP 下载至暂存目录 `~/.shrimp/skills/leo-autodl-imagine-video/outputs/`）
3. **底层 ComfyUI 节点图（Node DAG）Payload 与参数字典**（精确到每个节点 ID 与输入槽位）

---

## 1. 为什么生图支持 `sdxl` 与 `minimax_h3` 双引擎？

| 特性维度 | 引擎 A：`engine="sdxl"`（默认） | 引擎 B：`engine="minimax_h3"` |
| :--- | :--- | :--- |
| **核心模型** | `Juggernaut-XI` / `waiIllustriousSDXL` / `Z-Image` 等 114 个底模 + LoRA | `minimax_h3_ref2va` + **`Qwen3-VL 32B`** 多模态编码器 |
| **出图速度** | 极快（RTX 5090 上 20 步约 **5~6 秒**） | 首次加载后约 **10~15 秒**（若刚跑完 H3 视频，显存零切换开销！） |
| **核心优势** | 风格选择极多（写实/二次元/建筑），支持丰富 LoRA 叠加 | 1. **32B Qwen3-VL 超强中英文复杂排版与分镜理解**（如 5 宫格电影剧照分镜板）<br/>2. **原生支持最多 9 张参考图 (`--ref-images`)** 进行多角色同框、换装、场景迁移<br/>3. 与生视频共享同一套权重，**图生视频衔接时色彩与人物 ID 100% 零色差** |
| **节点图模板** | [sdxl_txt2img_api.json](workflows/sdxl_txt2img_api.json) | [minimax_h3_txt2img_api.json](workflows/minimax_h3_txt2img_api.json) |

---

## 2. Agent 高阶调用 API 与参数全表

### 2.1 Python SDK 方法签名
```python
client.generate_image(
    prompt: str,
    engine: str = "sdxl",  # 可选 "sdxl" 或 "minimax_h3"（若传入 reference_images 会自动切换为 "minimax_h3"）
    negative_prompt: str = "low quality, bad quality, blurry, deformed, watermark, text, signature, bad anatomy, extra digits",
    width: int = 1024,
    height: int = 1024,
    steps: int = None,     # sdxl 默认 20，minimax_h3 默认 12
    cfg: float = None,     # sdxl 默认 7.0，minimax_h3 默认 1.0
    sampler_name: str = None,  # sdxl 默认 "dpmpp_2m"，minimax_h3 默认 "euler"
    scheduler: str = None,     # sdxl 默认 "karras"，minimax_h3 默认 "beta"
    denoise: float = 1.0,
    seed: int = None,
    checkpoint: str = "Juggernaut-XI-byRunDiffusion.safetensors",
    lora_name: str = None,
    lora_strength: float = 0.8,
    batch_size: int = 1,
    reference_images: list[str] = None,  # minimax_h3 专用：最多 9 张本地参考图路径
    diffusion_model: str = "minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    clip_model: str = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    video_vae: str = "minimax_h3_video_vae_fp16.safetensors",
    ref_image_size: str = "match",       # "match" 或 "max" (2048px 短边高保真)
    filename_prefix: str = None,
    output_dir: str = None               # 默认暂存至 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/
) -> dict
```

### 2.2 CLI 与 SDK 参数对照规范

| SDK 参数名 | CLI 标志 | 类型 | 默认值 | 取值范围 / 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `prompt` | `--prompt` | `str` | **(必填)** | 英文或中文正向视觉描述 |
| `engine` | `--engine` | `str` | `"sdxl"` | `"sdxl"`（标准底模+LoRA）或 `"minimax_h3"`（H3 单帧生图/多参考图编辑） |
| `negative_prompt` | `--negative-prompt` | `str` | `"low quality..."` | 排除负向特征描述（仅 `sdxl` 引擎使用；`minimax_h3` 使用 `ConditioningZeroOut`） |
| `width` | `--width` | `int` | `1024` | 32 的倍数（如 `1024`, `1280`, `1344`, `2048`） |
| `height` | `--height` | `int` | `1024` | 32 的倍数（如 `1024`, `736`, `768`, `2048`） |
| `steps` | `--steps` | `int` | 自动适配 | `sdxl` 默认 `20`；`minimax_h3` 默认 `12` |
| `cfg` | `--cfg` | `float` | 自动适配 | `sdxl` 默认 `7.0`；`minimax_h3` 默认 `1.0` |
| `sampler_name` | `--sampler` | `str` | 自动适配 | `sdxl` 默认 `"dpmpp_2m"`；`minimax_h3` 默认 `"euler"` |
| `scheduler` | `--scheduler` | `str` | 自动适配 | `sdxl` 默认 `"karras"`；`minimax_h3` 默认 `"beta"` |
| `seed` | `--seed` | `int` | 随机生成 | `1 ~ 999999999` |
| `checkpoint` | `--checkpoint` | `str` | `"Juggernaut-XI..."` | `sdxl` 引擎使用的底模文件名 |
| `lora_name` | `--lora` | `str` | `None` | `sdxl` 引擎可选挂载的 LoRA 文件名 |
| `reference_images` | `--ref-images` | `list` | `None` | `minimax_h3` 引擎支持传入 1~9 张参考图路径（自动 SFTP 上传至 `/root/ComfyUI/input/`） |
| `output_dir` | `--output-dir` | `str` | `~/.shrimp/skills/leo-autodl-imagine-video/outputs` | 默认先存放在 `~/.shrimp` 暂存目录，确认后再通过 `--export` 移至用户目标目录 |

---

## 3. 底层 ComfyUI 生图节点图 (Node DAG) 真实 Payload

### 3.1 引擎 A：`sdxl` 标准生图节点图（含可选 LoRA）
模板路径：[sdxl_txt2img_api.json](workflows/sdxl_txt2img_api.json)
* **Node `"4"` (`CheckpointLoaderSimple`)**：加载 `ckpt_name`
* **Node `"10"` (`LoraLoader`，可选)**：挂载 `lora_name`，`strength_model` / `strength_clip`
* **Node `"5"` (`EmptyLatentImage`)**：构建 `width` $\times$ `height` 空白潜空间
* **Node `"6"` / `"7"` (`CLIPTextEncode`)**：编码正向 `prompt` 与负向 `negative_prompt`
* **Node `"3"` (`KSampler`)**：执行去噪采样（默认 `dpmpp_2m` + `karras`, `steps=20`, `cfg=7.0`）
* **Node `"8"` (`VAEDecode`)** $\to$ **Node `"9"` (`SaveImage`)**：解码并保存 PNG

### 3.2 引擎 B：`minimax_h3` 生图与多图参考编辑节点图
模板路径：[minimax_h3_txt2img_api.json](workflows/minimax_h3_txt2img_api.json)（源自云端 `U33-Minimax-H3图像编辑全能工作流` 提炼）
* **Node `"1"` (`DiffusionModelLoaderKJ`)**：加载 `minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors`（或 `minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`）
* **Node `"2"` (`CLIPLoader`)**：加载 `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` (`type="minimax"`)
* **Node `"3"` (`VAELoader`)**：加载 `minimax_h3_video_vae_fp16.safetensors`
* **Node `"10"` (`VRGDG_MiniMaxH3ReferenceMediaFromPaths`)**：传入 0~9 张远端参考图路径数组 `image_paths`
* **Node `"4"` (`MiniMaxH3ReferenceToVideo`)**：
  * **关键参数**：设置 **`"length": 5`**（MiniMax H3 最小合法时序帧块），`width` / `height`（支持 `1280x736`、`1024x1024` 直至 `2048x2048` 4K 宫格分镜），`ref_image_size="match"`（或 `"max"`）。
* **Node `"5"` (`ConditioningZeroOut`)**：将正向 Conditioning 置零作为负向条件
* **Node `"6"` (`KSampler`)**：`steps=12`, `cfg=1.0`, `sampler_name="euler"`, `scheduler="beta"`, `denoise=1.0`
* **Node `"7"` (`VAEDecode`)** $\to$ **Node `"8"` (`ImageFromBatch`)**：设置 `{"batch_index": 0, "length": 1}` 从解码帧中精确抽取第 1 帧单张高清静帧图像 $\to$ **Node `"9"` (`SaveImage`)**。

---

## 4. 云端 100TB 共享盘已挂载的生图底模推荐表

| 风格场景 | 引擎 (`--engine`) | 推荐模型参数值 | 推荐参数搭配 |
| :--- | :--- | :--- | :--- |
| **电影级超写实摄影（默认）** | `sdxl` | `--checkpoint "Juggernaut-XI-byRunDiffusion.safetensors"` | `steps=20, cfg=7.0, sampler=dpmpp_2m, scheduler=karras` |
| **多参考图角色一致 / 电影分镜板 / 图生视频首帧** | `minimax_h3` | `--diffusion-model "minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"` | `steps=12, cfg=1.0, sampler=euler, scheduler=beta, width=1280, height=736` |
| **亚洲人像与国风写实** | `sdxl` | `--checkpoint "majicMIX_realistic_v7.safetensors"` | `steps=25, cfg=6.5, sampler=dpmpp_2m_sde, scheduler=karras` |
| **精品二次元 / 插画 (Illustrious)** | `sdxl` | `--checkpoint "SDXL/waiIllustriousSDXL_v150.safetensors"` | `steps=24, cfg=6.0, sampler=euler_ancestral, scheduler=normal` |
| **高速 8~12 步融合大模型** | `sdxl` | `--checkpoint "Amina-12steps-liuli-AIO-0_1.safetensors"` | `steps=10, cfg=2.0, sampler=dpmpp_sde, scheduler=karras` |
