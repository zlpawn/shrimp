# 图片生成真实 API 与工作流全解 (Image Generation API Reference)

本文档完整沉淀了 `leo-autodl-imagine-video` 在云端 ComfyUI 执行图片生成的**三层真实 API 规范**：
1. **Agent 高阶调用接口**（Python SDK 与 CLI 参数规范）
2. **远端 ComfyUI HTTP REST 通信协议**（提交、轮询、内省与 SFTP 下载）
3. **底层 ComfyUI 节点图（Node DAG）Payload 与参数字典**（精确到每个节点 ID 与输入槽位）

---

## 1. Agent 高阶调用 API 与参数全表

### 1.1 Python SDK 方法签名
```python
client.generate_image(
    prompt: str,
    negative_prompt: str = "low quality, bad quality, blurry, deformed, watermark, text, signature, bad anatomy, extra digits",
    width: int = 1024,
    height: int = 1024,
    steps: int = 20,
    cfg: float = 7.0,
    sampler_name: str = "dpmpp_2m",
    scheduler: str = "karras",
    denoise: float = 1.0,
    seed: int = None,
    checkpoint: str = "Juggernaut-XI-byRunDiffusion.safetensors",
    lora_name: str = None,
    lora_strength: float = 0.8,
    batch_size: int = 1,
    filename_prefix: str = "LeoAutoDL_Image",
    output_dir: str = "output"
) -> dict
```

### 1.2 CLI 与 SDK 参数对照规范

| SDK 参数名 | CLI 标志 | 类型 | 默认值 | 取值范围 / 枚举项 | 对应 ComfyUI 节点与槽位 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `prompt` | `--prompt` | `str` | **(必填)** | 英文或中文正向视觉描述 | Node `"6"` (`CLIPTextEncode.inputs.text`) |
| `negative_prompt` | `--negative-prompt` | `str` | `"low quality, bad quality..."` | 排除负向特征描述 | Node `"7"` (`CLIPTextEncode.inputs.text`) |
| `width` | `--width` | `int` | `1024` | 32 的倍数（如 `1024`, `1280`, `768`, `1152`） | Node `"5"` (`EmptyLatentImage.inputs.width`) |
| `height` | `--height` | `int` | `1024` | 32 的倍数（如 `1024`, `768`, `1280`, `640`） | Node `"5"` (`EmptyLatentImage.inputs.height`) |
| `steps` | `--steps` | `int` | `20` | `8 ~ 40`（SDXL 写实推荐 `20~28`，Turbo 推荐 `8~12`） | Node `"3"` (`KSampler.inputs.steps`) |
| `cfg` | `--cfg` | `float` | `7.0` | `1.0 ~ 15.0`（写实推荐 `5.0~7.5`，Lightning 推荐 `1.5~2.5`） | Node `"3"` (`KSampler.inputs.cfg`) |
| `sampler_name` | `--sampler` | `str` | `"dpmpp_2m"` | `dpmpp_2m`, `dpmpp_sde`, `dpmpp_2m_sde`, `euler`, `euler_ancestral`, `uni_pc`, `res_multistep` | Node `"3"` (`KSampler.inputs.sampler_name`) |
| `scheduler` | `--scheduler` | `str` | `"karras"` | `karras`, `normal`, `simple`, `sgm_uniform`, `exponential`, `beta` | Node `"3"` (`KSampler.inputs.scheduler`) |
| `denoise` | `--denoise` | `float` | `1.0` | `0.0 ~ 1.0`（文生图固定 `1.0`） | Node `"3"` (`KSampler.inputs.denoise`) |
| `seed` | `--seed` | `int` | 随机生成 | `1 ~ 999999999`（固定种子可复现画面） | Node `"3"` (`KSampler.inputs.seed`) |
| `checkpoint` | `--checkpoint` | `str` | `"Juggernaut-XI-byRunDiffusion.safetensors"` | 云端 `CheckpointLoaderSimple` 列表中的模型文件名 | Node `"4"` (`CheckpointLoaderSimple.inputs.ckpt_name`) |
| `lora_name` | `--lora` | `str` | `None` | 云端 `LoraLoader` 列表中的 LoRA 文件名（非必填） | Node `"10"` (`LoraLoader.inputs.lora_name`) |
| `lora_strength` | `--lora-strength` | `float` | `0.8` | `-2.0 ~ 2.0`（推荐 `0.6 ~ 0.9`） | Node `"10"` (`strength_model` / `strength_clip`) |
| `batch_size` | `--batch-size` | `int` | `1` | `1 ~ 4` | Node `"5"` (`EmptyLatentImage.inputs.batch_size`) |
| `output_dir` | `--output-dir` | `str` | `"output"` | 本地保存目录路径 | SFTP 回传目标目录 |

### 1.3 返回 JSON 数据结构
```json
{
  "ok": true,
  "task_type": "image",
  "prompt": "A serene cybernetic cat sitting on a neon rooftop, 8k, photorealistic",
  "negative_prompt": "low quality, bad quality, blurry, deformed, watermark, text, signature, bad anatomy, extra digits",
  "prompt_id": "a7f2d9c1-44b8-41e3-9e12-8b3d0e5a9123",
  "seed": 482910341,
  "width": 1024,
  "height": 1024,
  "steps": 20,
  "cfg": 7.0,
  "sampler_name": "dpmpp_2m",
  "scheduler": "karras",
  "checkpoint": "Juggernaut-XI-byRunDiffusion.safetensors",
  "lora_name": null,
  "elapsed_seconds": 6.2,
  "output_files": [
    "D:/agent-transfer/output/LeoAutoDL_Image_00001_.png"
  ],
  "message": "图片生成完成 (耗时 6.2s)"
}
```

---

## 2. 远端 ComfyUI HTTP REST 真实调用全链路

在云端实例内部，ComfyUI 监听 `http://127.0.0.1:6006`。`remote_engine.py` 通过 SSH 隧道依次执行以下 4 步 API 调用：

1. **枚举可用模型（可选内省）**：
   * **请求**：`GET http://127.0.0.1:6006/object_info/CheckpointLoaderSimple`
   * **响应提取路径**：`response["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]`
2. **提交工作流 DAG 任务**：
   * **请求**：`POST http://127.0.0.1:6006/prompt`
   * **Headers**：`{"Content-Type": "application/json"}`
   * **Body**：`{"prompt": <Workflow_DAG_Dict>}`
   * **响应**：`{"prompt_id": "a7f2d9c1-...", "number": 1, "node_errors": {}}`
3. **轮询任务执行历史与产物文件名**：
   * **请求**：`GET http://127.0.0.1:6006/history/{prompt_id}`（每 1 秒轮询一次，超时 120 秒）
   * **响应提取路径**：
     ```json
     {
       "a7f2d9c1-...": {
         "outputs": {
           "9": {
             "images": [
               {
                 "filename": "LeoAutoDL_Image_00001_.png",
                 "subfolder": "",
                 "type": "output"
               }
             ]
           }
         }
       }
     }
     ```
4. **SFTP 二进制拉取回本地**：
   * **远端绝对路径**：`/root/ComfyUI/output/LeoAutoDL_Image_00001_.png`
   * **传输方式**：`sftp.get(remote_file, local_file)`

---

## 3. 底层 ComfyUI 生图节点图 (Node DAG) 真实 Payload

标准模板文件保存在：[sdxl_txt2img_api.json](workflows/sdxl_txt2img_api.json)。

### 3.1 完整 JSON Payload（含可选 LoRA 串联拓扑）
```json
{
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {
      "ckpt_name": "Juggernaut-XI-byRunDiffusion.safetensors"
    }
  },
  "10": {
    "class_type": "LoraLoader",
    "inputs": {
      "lora_name": "推文MJ画风_v1.0.safetensors",
      "strength_model": 0.8,
      "strength_clip": 0.8,
      "model": ["4", 0],
      "clip": ["4", 1]
    }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "Masterpiece, photorealistic portrait...",
      "clip": ["10", 1]
    }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "low quality, blurry, deformed, watermark, text",
      "clip": ["10", 1]
    }
  },
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 42,
      "steps": 20,
      "cfg": 7.0,
      "sampler_name": "dpmpp_2m",
      "scheduler": "karras",
      "denoise": 1.0,
      "model": ["10", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "LeoAutoDL_Image",
      "images": ["8", 0]
    }
  }
}
```
> **注**：当未指定 `lora_name` 时，不生成节点 `"10"`，节点 `"6"`、`"7"` 的 `clip` 直接连向 `["4", 1]`，节点 `"3"` 的 `model` 直接连向 `["4", 0]`。

---

## 4. 云端 100TB 共享盘已挂载的生图底模推荐表

通过 `--list-models checkpoints` 实测验证，云端包含 114 个生图 Checkpoint，按场景推荐如下：

| 风格场景 | 推荐 `checkpoint` 参数值 | 推荐参数搭配 |
| :--- | :--- | :--- |
| **电影级超写实摄影（默认）** | `Juggernaut-XI-byRunDiffusion.safetensors` | `steps=20, cfg=7.0, sampler=dpmpp_2m, scheduler=karras` |
| **亚洲人像与国风写实** | `majicMIX_realistic_v7.safetensors` 或 `SDXL/IL-perfectionRealisticILXL_33.safetensors` | `steps=25, cfg=6.5, sampler=dpmpp_2m_sde, scheduler=karras` |
| **精品二次元 / 插画 (Illustrious)** | `SDXL/waiIllustriousSDXL_v150.safetensors` 或 `SDXL/ChenkinNoob-XL-V0.5.safetensors` | `steps=24, cfg=6.0, sampler=euler_ancestral, scheduler=normal` |
| **高速 8~12 步融合大模型** | `Amina-12steps-liuli-AIO-0_1.safetensors` 或 `dreamshaperXL_lightningDPMSDE.safetensors` | `steps=10, cfg=2.0, sampler=dpmpp_sde, scheduler=karras` |
| **Z-Image 8 步极速写实** | `Zimage/Z-Image-Base-8steps-White_Marble-AIO_v2-bf16.safetensors` | `steps=8, cfg=2.0, sampler=euler, scheduler=simple` |
| **建筑与室内空间设计** | `architecturerealmix_v11.safetensors` / `interiordesignsuperm_v2.safetensors` | `steps=25, cfg=7.0, sampler=dpmpp_2m, scheduler=karras` |
