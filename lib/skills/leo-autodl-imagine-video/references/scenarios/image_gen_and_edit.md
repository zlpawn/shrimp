# 场景指南 1：MiniMax-H3 生图、多参考图合拍与电影分镜板 (Image Gen & Multi-Ref Editing)

本文档指导 Agent 使用 **MiniMax-H3 (`U33` 体系)** 进行单张高清写实生图、1~9 张参考图角色一致性合拍/换装，以及多宫格电影剧照分镜板生成。

* **对应成熟工作流模板**：[minimax_h3_image_u33_api.json](../workflows/minimax_h3_image_u33_api.json)
* **远端源工作流参考**：`/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/U33-Minimax-H3图像编辑全能工作流.json`

---

## 1. 为什么用 MiniMax-H3 生图？

1. **Qwen3-VL 32B 顶级理解力**：相比传统 SDXL 的 77-token CLIP，MiniMax-H3 搭载 32B 参数视觉语言大模型，能读懂上千字的分镜剧本、精确的空间站位关系（谁在左、谁在右、前景/背景）以及中英文复杂指令。
2. **原生最多 9 张参考图输入 (`--ref-images`)**：无需繁琐训练 LoRA 或配置 IP-Adapter，直接传入角色大头照、全身服装图、场景图、道具图，即可实现高保真锁脸合拍与换装。
3. **生图 $\to$ 生视频零色差衔接**：生成的定妆照或分镜图与后续生视频使用完全相同的 H3 潜空间与 VAE，直接作为首帧送入生视频工作流时**光影、肤色、五官 100% 连贯无跳变**。

---

## 2. 工作流节点拓扑与核心参数 (`minimax_h3_image_u33_api.json`)

| 节点 ID | 节点类型 (`class_type`) | 默认参数配置 | 调优说明 |
| :--- | :--- | :--- | :--- |
| **`"1"`** | `DiffusionModelLoaderKJ` | `model_name`: `minimax/minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 多图复杂编辑/分镜板可切换为 `minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors` 或 `FeiHou` 版 |
| **`"2"`** | `CLIPLoader` | `clip_name`: `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` (`type="minimax"`) | 多参考图复杂提示词可切为 `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` |
| **`"3"`** | `VAELoader` | `vae_name`: `minimax_h3_video_vae_fp16.safetensors` | 追求极致毛孔与发丝锐度可切为 `MiniMax-H3-X2-Detail-v1.safetensors` |
| **`"10"`** | `VRGDG_MiniMaxH3ReferenceMediaFromPaths` | `image_paths`: `"[]"` | 当传入 `--ref-images` 时，引擎自动 SFTP 上传本地图片并填入远端路径数组 |
| **`"4"`** | `MiniMaxH3ReferenceToVideo` | `width`: `1280`, `height`: `736`, **`length`: `5`**, `ref_image_size`: `"match"` | `length=5` 是 H3 最小帧块；有参考图且追求最高人脸相似度时设 `ref_image_size="max"` |
| **`"5"`** | `ConditioningZeroOut` | 将节点 `"4"` 的正向条件置零作为负向条件 | H3 在 `cfg=1.0` 下无需手写负向提示词，直接置于 Prompt 末尾约束即可 |
| **`"6"`** | `KSampler` | `steps`: `12`, `cfg`: `1.0`, `sampler_name`: `"euler"`, `scheduler`: `"beta"` | **黄金组合**：`euler` + `beta` + `cfg=1.0`，画面干净通透；高细节可设 `steps=15~18` |
| **`"7"` $\to$ `"8"` $\to$ `"9"`** | `VAEDecode` $\to$ `ImageFromBatch` $\to$ `SaveImage` | `batch_index`: `0`, `length`: `1` | 从解码帧块中精准抽取第 1 帧保存为单张高清 PNG |

---

## 3. 三大典型生图场景调用方法与 Prompt 公式

### 3.1 场景 A：单张电影级写实生图（角色定妆照 / 概念场景）
```bash
& $PYTHON_BIN $CLI_PATH --image \
  --prompt "写实电影剧照质感，35mm镜头，浅景深。雨夜霓虹街头，一位身穿黑色机能风衣的赛博朋克少女微微侧头看向镜头，发丝微湿，蓝紫霓虹轮廓光，真实皮肤纹理与毛孔细节，8K超高清，无文字无水印。" \
  --width 1280 --height 736 --steps 12 --json
```
* **画幅推荐**：
  * 横屏电影感：`--width 1280 --height 736` 或 `--width 1344 --height 768`
  * 竖屏人像写真：`--width 736 --height 1280` 或 `--width 768 --height 1344`
  * 正方形构图：`--width 1024 --height 1024`

### 3.2 场景 B：多参考图角色锁脸、换装与多角色同框 (`--ref-images`)
当用户提供 1~9 张参考图（例如 `role_a.png` 角色脸部、`outfit.png` 衣服、`scene.png` 场景）时：
```bash
& $PYTHON_BIN $CLI_PATH --image \
  --ref-images "D:/assets/role_a.png,D:/assets/outfit.png,D:/assets/scene.png" \
  --ref-image-size max \
  --diffusion-model "minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors" \
  --clip-model "qwen3vl_32b_minimax_h3_int8_convrot.safetensors" \
  --prompt "【参考图标注】Image 1(角色参考): 严格保留图1人物的面部五官与发型特征，只提供样貌，不提供姿势。Image 2(服装参考): 穿上图2中的汉服长裙。Image 3(场景参考): 站在图3的古风雪景梅林中。电影级柔和侧逆光，浅景深，真实皮肤纹理，8K。" \
  --width 1280 --height 736 --steps 15 --json
```

### 3.3 场景 C：2048x2048 多宫格电影剧照分镜板（源自 `U33` 高阶玩法）
当需要一次性生成一套画风、角色完全统一的 **5 宫格（上2中1下2）或 4 宫格电影分镜图**时，将分辨率拉高至 `2048x2048`（或 `1920x1088`），并使用结构化分镜 Prompt：
```bash
& $PYTHON_BIN $CLI_PATH --image \
  --diffusion-model "minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors" \
  --clip-model "qwen3vl_32b_minimax_h3_int8_convrot.safetensors" \
  --width 2048 --height 2048 --steps 16 \
  --prompt "写实电影剧照式分镜板，4宫格布局（2x2网格），每格之间有清晰黑色电影边框。35mm变形镜头，复古胶片颗粒质感。第1格（左上·全景）：雨夜霓虹巷口，身穿黑风衣的侦探撑伞独行；第2格（右上·近景）：侦探停下脚步，低头看向地面发光的芯片，暖金高光落在脸庞；第3格（左下·微距特写）：手指拾起芯片，雨水顺着指尖滑落；第4格（右下·背影中景）：侦探转身走向巷子深处的神秘光门。严格保持四格主角服装与样貌一致，无字幕无水印。" \
  --json
```
