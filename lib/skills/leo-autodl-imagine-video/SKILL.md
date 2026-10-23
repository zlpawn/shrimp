---
name: leo-autodl-imagine-video
description: "Universal Agent skill to dispatch AI image generation (SDXL/FLUX/Z-Image/Illustrious with LoRA, or MiniMax H3 32B Qwen3-VL multi-reference image generation) and native audio-synced video generation (MiniMax H3 Text/Reference-to-Video) to remote AutoDL GPU instances via ComfyUI REST API, with staging output management and user-confirmed lifecycle control via AutoDL OpenAPI."
---

# leo-autodl-imagine-video

基于 AutoDL 云端旗舰 GPU（RTX 5090 / 4090 / vGPU-32G）的通用远程 **双引擎文生图（`sdxl` + `minimax_h3`）/ 多参考图编辑 / 音画同步文生视频 / 参考图生视频** Agent 技能。

---

## 1. 核心行为铁律 (Core Behavioral Rules — 必读)

> [!IMPORTANT]
> 1. **严禁私自关机（Mandatory User Confirmation for Power-Off）**：
>    * **Agent 绝不能在任务完成后私自调用 `--power-off` / `client.power_off()` 关机！**
>    * 必须先询问用户是否还需要继续生成，**仅在用户明确回复确认关机后**，才允许传入 `--confirm`（或 `confirm=True`）执行关机。未传确认标志时脚本会自动拦截拒绝。
> 2. **默认暂存输出与按需导出清理（Staging Directory & Cleanup）**：
>    * 所有生成的图片和视频默认统一保存在 **`~/.shrimp/skills/leo-autodl-imagine-video/outputs/`** 暂存目录下，不污染用户当前项目目录。
>    * 当用户选定最终满意的视频或图片、或指定保存位置时，调用 `--export <文件名> --to <用户目标路径> --clean-others`（或 `client.export_asset(..., clean_others=True)`）将其移动到用户指定目录，并清理暂存目录中无用的中间图片与视频。

---

## 2. 目录架构与环境隔离规范

* **技能源码目录**：
  * 项目仓库路径：`lib/skills/leo-autodl-imagine-video/`
  * 全局技能路径：`~/agents/skills/leo-autodl-imagine-video/`
* **专用持久化虚拟环境**：`~/.shrimp/skills/leo-autodl-imagine-video/.venv/`（预装 `paramiko`、`requests`；亦支持 `uv run scripts/client.py`）
* **运行时凭证配置（Git 隔离）**：`~/.shrimp/skills/leo-autodl-imagine-video/config.json`
* **默认媒体暂存目录**：`~/.shrimp/skills/leo-autodl-imagine-video/outputs/`

---

## 3. 核心 API 速查表 (API Overview for Agents)

### 3.1 生图 API (`generate_image` / `--image`) —— 支持 `sdxl` 与 `minimax_h3` 双引擎
* **底层协议**：SSH 隧道调用远端 ComfyUI `POST http://127.0.0.1:6006/prompt` $\to$ 轮询 `GET /history/{prompt_id}` $\to$ SFTP 下载至 `~/.shrimp/skills/leo-autodl-imagine-video/outputs/`。
* **双引擎对比**：
  * `--engine sdxl`（默认）：使用 `CheckpointLoaderSimple`（114+ 款写实/二次元底模）+ 可选 `LoraLoader`，5~6 秒极速出图。模板：[sdxl_txt2img_api.json](references/workflows/sdxl_txt2img_api.json)
  * `--engine minimax_h3`：**生图同样可用 MiniMax-H3！** 使用 `DiffusionModelLoaderKJ` (`minimax_h3_ref2va`) + `Qwen3-VL 32B` 多模态编码器 + `MiniMaxH3ReferenceToVideo(length=5)` + `ImageFromBatch` 抽取单帧。支持传入 **1~9 张参考图 (`--ref-images`)** 进行角色一致多图编辑、换装、场景迁移或 5 宫格电影剧照分镜板生成，且与生视频共享显存模型零切换开销！模板：[minimax_h3_txt2img_api.json](references/workflows/minimax_h3_txt2img_api.json)

| 参数 (SDK / CLI) | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` / `--prompt` | `str` | **(必填)** | 正向提示词（画面主体、光影、构图、画质） |
| `engine` / `--engine` | `str` | `"sdxl"` | `"sdxl"`（标准底模+LoRA）或 `"minimax_h3"`（H3 32B 编码器生图/多参考图编辑） |
| `negative_prompt` / `--negative-prompt` | `str` | `"low quality..."` | 负向提示词（`sdxl` 专用） |
| `width` / `--width` | `int` | `1024` | 图像宽度（32 的倍数，如 `1024`, `1280`, `2048`） |
| `height` / `--height` | `int` | `1024` | 图像高度（32 的倍数，如 `1024`, `736`, `768`, `2048`） |
| `steps` / `--steps` | `int` | 自动适配 | `sdxl` 默认 `20`；`minimax_h3` 默认 `12` |
| `cfg` / `--cfg` | `float` | 自动适配 | `sdxl` 默认 `7.0`；`minimax_h3` 默认 `1.0` |
| `sampler_name` / `--sampler` | `str` | 自动适配 | `sdxl` 默认 `"dpmpp_2m"`；`minimax_h3` 默认 `"euler"` |
| `scheduler` / `--scheduler` | `str` | 自动适配 | `sdxl` 默认 `"karras"`；`minimax_h3` 默认 `"beta"` |
| `checkpoint` / `--checkpoint` | `str` | `"Juggernaut-XI-byRunDiffusion.safetensors"` | `sdxl` 底模文件名 |
| `lora_name` / `--lora` | `str` | `None` | `sdxl` 可选挂载的 LoRA 文件名 |
| `reference_images` / `--ref-images` | `list` / `str` | `None` | `minimax_h3` 支持传入 1~9 张本地参考图（逗号分隔） |
| `seed` / `--seed` | `int` | 随机 | 随机种子 |
| `output_dir` / `--output-dir` | `str` | `~/.shrimp/.../outputs` | 默认暂存目录 |

### 3.2 生视频 API (`generate_video` / `--video`) —— MiniMax H3 音画同步
* **标准节点图模板**：[minimax_h3_video_audio_api.json](references/workflows/minimax_h3_video_audio_api.json)
* **核心参数**：

| 参数 (SDK / CLI) | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` / `--prompt` | `str` | **(必填)** | 画面描述 + 镜头运镜 + 环境音效/BGM + 角色台词（原生联合生成画面与同步音频） |
| `duration` / `--duration` | `float` | `3.0` | 视频时长（秒，推荐 `3.0 ~ 10.0`） |
| `aspect_ratio` / `--aspect-ratio` | `str` | `"16:9"` | 宽高比：`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `2:3`, `3:2`, `21:9` |
| `megapixels` / `--megapixels` | `float` | `0.9` | 画面总像素百万数（默认 `0.9` 对应 `1280x736`） |
| `steps` / `--steps` | `int` | `10` | 采样步数（启用 `EasyCache` 下 `10` 步约 19 秒） |
| `reference_images` / `--ref-images` | `list` / `str` | `None` | 本地参考图路径（1~9 张，逗号分隔），驱动图生视频/多图参考生视频 |
| `diffusion_model` / `--diffusion-model` | `str` | `"minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"` | 视频主模型 |
| `crf` / `--crf` | `int` | `19` | H.264 MP4 压制质量 |
| `output_dir` / `--output-dir` | `str` | `~/.shrimp/.../outputs` | 默认暂存目录 |

### 3.3 资产导出清理与实例运维 API
* `client.export_asset(src_file, target_path, move=True, clean_others=False)` / `--export <文件名> --to <目标路径> [--clean-others]`：将用户选定的最终图片或视频移动到用户指定目录，并可选清理暂存目录中其余无用文件。
* `client.clean_outputs()` / `--clean-outputs`：清理 `~/.shrimp/skills/leo-autodl-imagine-video/outputs/` 下所有无用暂存图片与视频。
* `client.probe()` / `--probe`：检测 SSH 连通性、GPU 显存与 ComfyUI 状态（端口变更自动通过 OpenAPI 自愈）。
* `client.power_on()` / `--power-on`：调用 AutoDL OpenAPI 远程有卡开机并自动刷新 SSH 端口。
* `client.power_off(confirm=True)` / `--power-off --confirm`：**（必须获用户明确同意后调用）** 远程关机并停止计费。
* `client.list_models(category)` / `--list-models [all|checkpoints|diffusion_models|clips|vaes|loras]`：枚举云端可用模型。

---

## 4. 快速调用示例 (Quick Start)

### 4.1 CLI 命令行调用

```bash
PYTHON_BIN="$HOME/.shrimp/skills/leo-autodl-imagine-video/.venv/Scripts/python.exe"
CLI_PATH="lib/skills/leo-autodl-imagine-video/scripts/client.py"

# 1. 探活 / 远程开机
& $PYTHON_BIN $CLI_PATH --probe --json
& $PYTHON_BIN $CLI_PATH --power-on --json

# 2. 使用 SDXL 引擎极速生图（默认存入 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/）
& $PYTHON_BIN $CLI_PATH --image --engine sdxl \
  --prompt "A serene cybernetic cat sitting on a neon rooftop, 8k, photorealistic" \
  --width 1024 --height 1024 --steps 20 --json

# 3. 使用 MiniMax-H3 引擎生图（支持 32B Qwen3-VL 复杂提示词与 --ref-images 多图参考）
& $PYTHON_BIN $CLI_PATH --image --engine minimax_h3 \
  --prompt "A cinematic close-up portrait of a cyberpunk girl in neon rain, glowing blue eyes, 8k photorealistic masterpiece" \
  --width 1280 --height 736 --steps 12 --json

# 4. 使用 MiniMax-H3 生成音画同步视频
& $PYTHON_BIN $CLI_PATH --video \
  --prompt "A sleek futuristic sports car speeding through neon rain at night, roaring V8 engine sound, heavy rain and thunder audio, 8k cinematic" \
  --duration 3.0 --aspect-ratio "16:9" --steps 10 --json

# 5. 用户选定满意产物后，移动至用户指定的目录并清理无用的中间图片/视频
& $PYTHON_BIN $CLI_PATH --export "MiniMaxH3_Image_00001_.png" --to "D:/my-project/assets/hero.png" --clean-others --json

# 6. 【仅在用户明确确认关机后】执行远程关机停止计费
& $PYTHON_BIN $CLI_PATH --power-off --confirm --json
```

---

## 5. 深入参考文档与工作流资产 (References)

* **生图真实 API 与双引擎（`sdxl` / `minimax_h3`）详解**：[references/image_generation.md](references/image_generation.md)
* **生视频真实 API 与 MiniMax H3 15 节点拓扑详解**：[references/video_generation.md](references/video_generation.md)
* **AutoDL 官方 OpenAPI、关机确认铁律与暂存清理手册**：[references/troubleshooting.md](references/troubleshooting.md)
* **SDXL 生图 ComfyUI JSON 模板**：[references/workflows/sdxl_txt2img_api.json](references/workflows/sdxl_txt2img_api.json)
* **MiniMax H3 生图 ComfyUI JSON 模板**：[references/workflows/minimax_h3_txt2img_api.json](references/workflows/minimax_h3_txt2img_api.json)
* **MiniMax H3 音画同步生视频 ComfyUI JSON 模板**：[references/workflows/minimax_h3_video_audio_api.json](references/workflows/minimax_h3_video_audio_api.json)
