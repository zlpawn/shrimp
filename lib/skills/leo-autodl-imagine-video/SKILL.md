---
name: leo-autodl-imagine-video
description: "MiniMax-H3 dedicated cloud image & audio-synced video generation skill on AutoDL ComfyUI. Prioritizes mature battle-tested MiniMax-H3 workflows (U00~U43 & VRGDG API templates) for text/multi-reference image generation, storyboards, and native audio video generation, while empowering Agents to dynamically inspect nodes, patch/customize ComfyUI workflows, and continuously evolve scenario recipes."
---

# leo-autodl-imagine-video

基于 AutoDL 共创云 (`www.autodl.art`) 旗舰 GPU 与 ComfyUI 的 **MiniMax-H3 专属远程生图与音画同步生视频技能**。
生图与生视频**统一采用 `MiniMax-H3` 体系**（`MiniMax-H3 DiT` + `Qwen3-VL 32B` 多模态编码器 + `MiniMax Video/Audio VAE`），兼具顶级的多参考图一致性、复杂分镜理解力与原生同步音频生成能力。

---

## 1. 核心工作流与三大铁律 (Core Philosophy & Iron Rules)

> [!IMPORTANT]
> 1. **“先选成熟流 $\to$ 不满意再调优 $\to$ 沉淀新配方”三步法**：
>    * **第一步（优先选用成熟工作流）**：接到生图或生视频任务时，优先使用 `references/workflows/` 中已沉淀的成熟工作流（或从远端 `/root/ComfyUI/` 预置的 40+ 个成熟 `U00~U43` / `VRGDG` 工作流中选取）跑出初版。
>    * **第二步（按需动态调优工作流）**：若用户对初版效果不满意（如“画面发糊/油腻”、“参考图人物不像”、“动作幅度不够”），查阅 [workflow_tuning_guide.md](references/workflow_tuning_guide.md)，使用 `--workflow`、`--patch` 或修改工作流 JSON（换 `FeiHou`/`Dasiwa`/`Singularity` 底模、挂 `电影感H3` LoRA、换 `MiniMax-H3-X2-Detail-v1` VAE、调低 `EasyCache` 阈值或启用二采）。
>    * **第三步（反哺沉淀）**：验证出效果极佳的新工作流或调优配方后，将其存入 `references/workflows/` 与 `references/scenarios/`，让技能持续进化。
> 2. **严禁私自关机（Mandatory User Confirmation for Power-Off）**：
>    * **Agent 绝不能在任务结束后私自调用 `--power-off` / `client.power_off()` 关机！**
>    * 必须先询问用户是否还有后续生成或调优需求，**仅在用户明确回复确认关机后**，才允许传入 `--confirm`（或 `confirm=True`）执行关机。
> 3. **默认暂存输出与按需导出清理（Staging & Cleanup）**：
>    * 所有生成的图片和视频默认统一保存在 **`~/.shrimp/skills/leo-autodl-imagine-video/outputs/`** 暂存目录，不污染当前项目目录。
>    * 当用户选定最终满意的产物后，使用 `--export <文件名> --to <用户目标路径> --clean-others` 将其移至指定位置并清理无用的中间草稿。

---

## 2. 模块化知识库与成熟工作流导航 (`references/`)

本技能的知识库按**环境协议、调优总纲、业务场景、工作流 JSON** 四层模块化组织，支持不断扩展沉淀：

* **环境与远端工作流索引**：[references/autodl_env_and_api.md](references/autodl_env_and_api.md)
  * AutoDL OpenAPI 开关机与动态端口自愈协议 + 远端 `/root/ComfyUI/` 预置 **43+ 个成熟 MiniMax-H3 工作流 (`U00~U43` & `VRGDG`)** 完整目录索引。
* **工作流构建与画质调优总纲**：[references/workflow_tuning_guide.md](references/workflow_tuning_guide.md)
  * 云端所有可用 `MiniMax-H3` 主模型、`Qwen3-VL 32B` 编码器、`X2-Detail VAE`、`电影感H3 LoRA` 选型表，以及“去糊/去油腻/锁脸/武戏高动态/文戏台词”四大定向调优处方。
* **分场景实战指南 (`references/scenarios/`)**：
  * [scenarios/image_gen_and_edit.md](references/scenarios/image_gen_and_edit.md) —— **场景 1：MiniMax-H3 高清生图、1~9 张参考图锁脸换装、2048x2048 电影剧照分镜板**（基于 `U33`）
  * [scenarios/video_t2v_and_ref2v.md](references/scenarios/video_t2v_and_ref2v.md) —— **场景 2：音画同步文生视频与多图参考生视频**（基于 `VRGDG` 官流）
  * [scenarios/video_cinematic_and_action.md](references/scenarios/video_cinematic_and_action.md) —— **场景 3：高清去油腻电影流、高动态武戏与细腻台词文戏进阶调优**（基于 `FeiHou + 电影感LoRA + X2-Detail VAE`）
* **即用型 API 工作流模板库 (`references/workflows/`)**：
  * [workflows/minimax_h3_image_u33_api.json](references/workflows/minimax_h3_image_u33_api.json) —— 生图 / 多图参考编辑 / 宫格分镜板标准流
  * [workflows/minimax_h3_video_1pass_api.json](references/workflows/minimax_h3_video_1pass_api.json) —— 音画同步快速单采视频流（~19s 极速出片）
  * [workflows/minimax_h3_video_cinematic_lora_api.json](references/workflows/minimax_h3_video_cinematic_lora_api.json) —— 高清去油腻电影感视频流（搭载 `FeiHou` + `电影感H3 LoRA` + `X2-Detail VAE`）

---

## 3. CLI 与工作流编排命令速查

```bash
PYTHON_BIN="$HOME/.shrimp/skills/leo-autodl-imagine-video/.venv/Scripts/python.exe"
CLI_PATH="lib/skills/leo-autodl-imagine-video/scripts/client.py"

# ==================== A. 探活、远程开机与模型/节点自省 ====================
# 1. 探活（若端口变更自动通过 OpenAPI 刷新自愈）
& $PYTHON_BIN $CLI_PATH --probe --json

# 2. 远程一键有卡开机
& $PYTHON_BIN $CLI_PATH --power-on --json

# 3. 查询云端 MiniMax-H3 可用模型/VAE/LoRA 清单，或查看任意 ComfyUI 节点输入定义
& $PYTHON_BIN $CLI_PATH --list-models all --json
& $PYTHON_BIN $CLI_PATH --inspect-node MiniMaxH3ReferenceToVideo --json

# 4. 列出或拉取 AutoDL 远端预置的 43+ 个成熟工作流 (U00~U43)
& $PYTHON_BIN $CLI_PATH --list-remote-workflows --json
& $PYTHON_BIN $CLI_PATH --fetch-remote-workflow "/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/U17-MiniMax-H3-latent放大模型双采加速-高动态不糊-去油腻-修音频-全能工作流.json"

# ==================== B. MiniMax-H3 生图与多图编辑 ====================
# 5. 单张写实生图 / 角色定妆照（默认存入 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/）
& $PYTHON_BIN $CLI_PATH --image \
  --prompt "写实电影剧照，35mm镜头，雨夜霓虹街头，身穿黑风衣的赛博少女回眸，真实皮肤纹理，8K" \
  --width 1280 --height 736 --steps 12 --json

# 6. 多参考图合拍 / 换装 / 锁脸（支持 1~9 张参考图，开启 --ref-image-size max 高保真）
& $PYTHON_BIN $CLI_PATH --image \
  --ref-images "D:/assets/face.png,D:/assets/outfit.png" --ref-image-size max \
  --diffusion-model "minimax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors" \
  --clip-model "qwen3vl_32b_minimax_h3_int8_convrot.safetensors" \
  --prompt "Image 1(角色参考): 严格保留图1五官与发型。Image 2(服装参考): 穿上图2服饰站在霓虹天台上，电影级光影。" \
  --width 1280 --height 736 --steps 15 --json

# ==================== C. MiniMax-H3 音画同步生视频与动态调优 ====================
# 7. 快速音画同步视频初稿 (1-pass 标准流)
& $PYTHON_BIN $CLI_PATH --video \
  --prompt "A sleek cyberpunk sports car speeding through neon rain, dynamic tracking shot. Audio direction: roaring V8 engine, heavy rain and thunder, dark synthwave bass." \
  --duration 4.0 --aspect-ratio "16:9" --steps 10 --json

# 8. 切换至【高清去油腻电影感工作流】+ 动态 Patch 任意节点参数
& $PYTHON_BIN $CLI_PATH --video \
  --workflow "minimax_h3_video_cinematic_lora_api.json" \
  --ref-images "C:/Users/xtea/.shrimp/skills/leo-autodl-imagine-video/outputs/MiniMaxH3_Image_00001_.png" \
  --ref-image-size max \
  --patch "160.inputs.strength_model=0.8" \
  --patch "174.inputs.reuse_threshold=0.08" \
  --prompt "图1中的少女在雨夜缓缓转头，轻声说：'好久不见。' Audio direction: 清冷年轻女性中文配音：'好久不见。' 伴随雨滴声。" \
  --duration 4.0 --steps 16 --crf 17 --json

# 9. 直接运行 Agent 自己编写或重组的工作流 JSON 文件
& $PYTHON_BIN $CLI_PATH --run-workflow "path/to/custom_minimax_workflow.json" --ref-images "ref.png" --json

# ==================== D. 最终资产导出、清理与确认关机 ====================
# 10. 将用户满意的最终产物移至用户指定目录，并清理暂存目录中其余无用草稿
& $PYTHON_BIN $CLI_PATH --export "MiniMaxH3_Cinematic_HD_00001-audio.mp4" --to "D:/my-project/videos/" --clean-others --json

# 11. 【仅在用户明确确认同意关机后执行】远程关机停止计费
& $PYTHON_BIN $CLI_PATH --power-off --confirm --json
```
