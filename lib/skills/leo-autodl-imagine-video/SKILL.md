---
name: leo-autodl-imagine-video
description: "Universal Agent skill to dispatch AI image generation (SDXL/FLUX/Z-Image/Illustrious with LoRA) and native audio-synced video generation (MiniMax H3 Text/Reference-to-Video) to remote AutoDL GPU instances via ComfyUI REST API, with full lifecycle management (power-on, power-off, dynamic SSH credential sync) via AutoDL OpenAPI."
---

# leo-autodl-imagine-video

基于 AutoDL 云端旗舰 GPU（RTX 5090 / 4090 / vGPU-32G）的通用远程 **文生图 / LoRA 生图 / 音画同步文生视频 / 参考图生视频** Agent 技能。
支持全自动生命周期闭环：**“远程 API 开机 $\to$ 动态刷新 SSH 端口凭证 $\to$ ComfyUI 节点图提交渲染 $\to$ SFTP 资产回传本地 $\to$ 远程 API 关机停止计费”**。

---

## 1. 触发场景 (Triggers)

当用户或上游 Agent 提出以下需求时，调用本技能：
1. **音画同步视频生成（Text-to-Video + Audio）**：使用云端 MiniMax H3 模型生成 720P 高清视频，并原生同步生成环境音效、动作拟音、BGM 或人物台词。
2. **参考图生视频（Image/Reference-to-Video + Audio）**：传入 1~9 张本地参考图片（`--ref-images`），自动上传至云端驱动角色/场景一致性动态视频生成。
3. **高质量文生图与 LoRA 生图（Text-to-Image）**：调用云端 100TB 共享模型盘上的 114+ 款写实（`Juggernaut-XI`）、二次元（`waiIllustriousSDXL`）、极速（`Z-Image` / `Lightning`）大模型及 LoRA 极速出图。
4. **云端模型资产枚举与实例生命周期运维**：实时查询云端挂载的模型列表（`--list-models`），或通过 AutoDL 官方 OpenAPI 远程开机（`--power-on`）、远程关机（`--power-off`）、自动刷新动态 SSH 端口（`--refresh`）。

---

## 2. 目录架构与环境隔离规范

* **技能源码目录**：
  * 项目仓库路径：`lib/skills/leo-autodl-imagine-video/`
  * 全局技能路径：`~/agents/skills/leo-autodl-imagine-video/`
* **专用持久化虚拟环境**：`~/.shrimp/skills/leo-autodl-imagine-video/.venv/`（已预装 `paramiko`、`requests` 等全部依赖；亦支持 `uv run scripts/client.py` 直接运行）
* **运行时凭证配置（Git 隔离）**：`~/.shrimp/skills/leo-autodl-imagine-video/config.json`（持久化保存 `host`, `port`, `password`, `token`, `instance_uuid`，绝不写入代码库）

---

## 3. 核心 API 速查表 (API Overview for Agents)

本技能封装了三大 API 能力层，所有底层 HTTP 端点、ComfyUI 节点图 JSON 及字段说明均已完整沉淀在 `references/` 目录下：

### 3.1 生图 API (`generate_image` / `--image`)
* **底层协议**：SSH 隧道调用远端 ComfyUI `POST http://127.0.0.1:6006/prompt` $\to$ 轮询 `GET /history/{prompt_id}` $\to$ SFTP 拉取 `/root/ComfyUI/output/LeoAutoDL_Image_*.png`。
* **标准节点图模板**：[references/workflows/sdxl_txt2img_api.json](references/workflows/sdxl_txt2img_api.json)
* **核心参数**：

| 参数 (SDK / CLI) | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` / `--prompt` | `str` | **(必填)** | 正向提示词（画面主体、光影、构图、画质） |
| `negative_prompt` / `--negative-prompt` | `str` | `"low quality..."` | 负向提示词 |
| `width` / `--width` | `int` | `1024` | 图像宽度（32 的倍数，如 `1024`, `1280`, `768`） |
| `height` / `--height` | `int` | `1024` | 图像高度（32 的倍数，如 `1024`, `768`, `1280`） |
| `steps` / `--steps` | `int` | `20` | 采样步数（写实推荐 `20~28`，Turbo 推荐 `8~12`） |
| `cfg` / `--cfg` | `float` | `7.0` | 提示词引导系数（写实 `5.0~7.5`，Lightning `1.5~2.5`） |
| `sampler_name` / `--sampler` | `str` | `"dpmpp_2m"` | 采样器：`dpmpp_2m`, `dpmpp_sde`, `euler`, `euler_ancestral`, `uni_pc` |
| `scheduler` / `--scheduler` | `str` | `"karras"` | 调度器：`karras`, `normal`, `simple`, `sgm_uniform`, `beta` |
| `checkpoint` / `--checkpoint` | `str` | `"Juggernaut-XI-byRunDiffusion.safetensors"` | 底模文件名（可通过 `--list-models checkpoints` 查询全量 114 个模型） |
| `lora_name` / `--lora` | `str` | `None` | 可选挂载的 LoRA 文件名（自动注入 Node `"10"` `LoraLoader`） |
| `lora_strength` / `--lora-strength` | `float` | `0.8` | LoRA 权重强度 |
| `seed` / `--seed` | `int` | 随机 | 随机种子 |
| `output_dir` / `--output-dir` | `str` | `"output"` | 本地输出目录 |

### 3.2 生视频 API (`generate_video` / `--video`)
* **底层协议**：SSH 隧道调用远端 ComfyUI `POST http://127.0.0.1:6006/prompt`（驱动 15 节点 MiniMax H3 音视频联合工作流）$\to$ 轮询 `GET /history/{prompt_id}` $\to$ SFTP 拉取 `/root/ComfyUI/output/MiniMaxH3_BuiltInAudio_Builder_*-audio.mp4`。
* **标准节点图模板**：[references/workflows/minimax_h3_video_audio_api.json](references/workflows/minimax_h3_video_audio_api.json)
* **核心参数**：

| 参数 (SDK / CLI) | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` / `--prompt` | `str` | **(必填)** | 画面描述 + 镜头运镜 + 环境音效/BGM + 角色台词（支持音画联合生成） |
| `duration` / `--duration` | `float` | `3.0` | 视频时长（秒，推荐 `3.0 ~ 10.0`，自动按 24fps 转换为 $17n+5$ 帧） |
| `aspect_ratio` / `--aspect-ratio` | `str` | `"16:9"` | 宽高比：`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `2:3`, `3:2`, `21:9` |
| `megapixels` / `--megapixels` | `float` | `0.9` | 画面总像素百万数（默认 `0.9` 对应 `1280x736`） |
| `steps` / `--steps` | `int` | `10` | 采样步数（启用 `EasyCache` 加速下 `10` 步在 RTX 5090 上约 19 秒） |
| `reference_images` / `--ref-images` | `list` / `str` | `None` | 本地参考图路径（多张用逗号分隔），自动 SFTP 上传至云端驱动图生视频 |
| `diffusion_model` / `--diffusion-model` | `str` | `"minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors"` | 视频主模型（可通过 `--list-models diffusion_models` 查询） |
| `clip_model` / `--clip-model` | `str` | `"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"` | 多模态文本编码器 |
| `crf` / `--crf` | `int` | `19` | H.264 MP4 压制质量（默认 `19` 高清） |
| `seed` / `--seed` | `int` | 随机 | 随机种子 |
| `output_dir` / `--output-dir` | `str` | `"output"` | 本地输出目录 |

### 3.3 AutoDL 官方 OpenAPI 与模型内省 API
* `client.probe()` / `--probe`：检测 SSH 连通性、GPU 显存与 ComfyUI 状态；若端口变更自动调用 OpenAPI 自愈更新。
* `client.power_on()` / `--power-on`：调用 `POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/power_on` 远程有卡开机并自动刷新 SSH 端口。
* `client.power_off()` / `--power-off`：调用 `POST https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/power_off` 远程关机并停止计费。
* `client.refresh()` / `--refresh`：调用 `GET https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/snapshot` 同步最新动态 SSH 端口与密码。
* `client.list_models(category)` / `--list-models [all|checkpoints|diffusion_models|clips|vaes|loras]`：调用远端 ComfyUI `GET /object_info/{node_class}` 实时枚举云端可用模型。

---

## 4. 快速调用示例 (Quick Start)

### 4.1 CLI 命令行调用（推荐添加 `--json` 供 Agent 解析）

```bash
PYTHON_BIN="$HOME/.shrimp/skills/leo-autodl-imagine-video/.venv/Scripts/python.exe"
CLI_PATH="lib/skills/leo-autodl-imagine-video/scripts/client.py"

# 1. 探活（若实例关机则自动提示，若端口变更则自动通过 OpenAPI 修复）
& $PYTHON_BIN $CLI_PATH --probe --json

# 2. 远程一键开机 / 关机（停止计费）
& $PYTHON_BIN $CLI_PATH --power-on --json
& $PYTHON_BIN $CLI_PATH --power-off --json

# 3. 查询云端已挂载的模型列表
& $PYTHON_BIN $CLI_PATH --list-models checkpoints --json
& $PYTHON_BIN $CLI_PATH --list-models diffusion_models --json

# 4. 生成 SDXL 高清图片（支持自定义宽高、采样器、底模与 LoRA）
& $PYTHON_BIN $CLI_PATH --image \
  --prompt "A serene cybernetic cat sitting on a neon rooftop, 8k, photorealistic" \
  --negative-prompt "blurry, low quality, deformed, watermark" \
  --width 1024 --height 1024 --steps 20 --cfg 7.0 \
  --sampler dpmpp_2m --scheduler karras \
  --checkpoint "Juggernaut-XI-byRunDiffusion.safetensors" \
  --output-dir "output" --json

# 5. 生成 MiniMax H3 音画同步视频（支持文生视频或传入 --ref-images 图生视频）
& $PYTHON_BIN $CLI_PATH --video \
  --prompt "A sleek futuristic sports car speeding through neon rain at night, roaring V8 engine sound, heavy rain and thunder audio, 8k cinematic" \
  --duration 3.0 --aspect-ratio "16:9" --steps 10 \
  --output-dir "output" --json
```

### 4.2 Python SDK 编程调用

```python
import sys
from pathlib import Path

SKILL_SCRIPTS = Path("lib/skills/leo-autodl-imagine-video/scripts").resolve()
if str(SKILL_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SKILL_SCRIPTS))

from client import AutoDLMediaClient

client = AutoDLMediaClient(output_dir="output")

# 1. 探活；若实例已关机则自动远程开机
health = client.probe()
if not health["ok"] and health.get("error_type") == "INSTANCE_STOPPED":
    client.power_on()

# 2. 生成角色定妆照 (SDXL)
img_res = client.generate_image(
    prompt="Cinematic portrait of a female cyberpunk detective in neon rain, 35mm lens, 8k",
    width=1280,
    height=768,
    steps=20,
    cfg=7.0,
    checkpoint="Juggernaut-XI-byRunDiffusion.safetensors"
)
hero_image = img_res["output_files"][0]

# 3. 将定妆照作为参考图传入 MiniMax H3 生成音画同步视频 (Image-to-Video + Audio)
vid_res = client.generate_video(
    prompt="The detective from the reference image turns her head slowly in the neon rain, speaking calmly: 'Case closed.' Sound of rain pattering and ambient synth music.",
    duration=4.0,
    aspect_ratio="16:9",
    steps=10,
    reference_images=[hero_image]
)
print("生成视频路径:", vid_res["output_files"])
```

---

## 5. 深入参考文档与工作流资产 (References)

其他 Agent 如需了解或定制底层 ComfyUI 节点参数、模型权重清单或 AutoDL OpenAPI 报文结构，请直接查阅：
* **生图真实 API、节点图 Payload 与 114 个底模推荐**：[references/image_generation.md](references/image_generation.md)
* **生视频真实 API、MiniMax H3 15 节点拓扑与音画提示词公式**：[references/video_generation.md](references/video_generation.md)
* **AutoDL 官方 OpenAPI 规范与动态端口自愈手册**：[references/troubleshooting.md](references/troubleshooting.md)
* **标准生图 ComfyUI API JSON 模板**：[references/workflows/sdxl_txt2img_api.json](references/workflows/sdxl_txt2img_api.json)
* **标准生视频 ComfyUI API JSON 模板**：[references/workflows/minimax_h3_video_audio_api.json](references/workflows/minimax_h3_video_audio_api.json)
