---
name: leo-autodl-imagine-video
description: "MiniMax-H3 dedicated cloud image & audio-synced video generation skill on AutoDL ComfyUI. Uses verified MiniMax-H3 workflows for image and audio-video generation, and provides tools to inspect nodes, fetch remote U00~U43 workflows, patch/execute custom ComfyUI workflows, and evolve verified scenario recipes."
---

# leo-autodl-imagine-video

基于 AutoDL 共创云 (`www.autodl.art`) 旗舰 GPU 与 ComfyUI 的 **MiniMax-H3 专属远程生图与音画同步生视频技能**。
生图与生视频**统一采用 `MiniMax-H3` 体系**（`MiniMax-H3 DiT` + `Qwen3-VL 32B` 编码器 + `MiniMax Video/Audio VAE`）。

---

## 1. 核心行为铁律 (Iron Rules — 必读)

> [!IMPORTANT]
> 1. **实事求是与可持续验证原则**：
>    * 优先使用 `references/workflows/` 下**已经真机实测跑通**的两个基准工作流（生图 `minimax_h3_image_u33_api.json`、生视频 `minimax_h3_video_1pass_api.json`）。
>    * 若用户对效果不满意需要调优，或需使用二采超分、武戏、文戏等进阶工作流，Agent 可通过 `--patch` 修改已知节点参数，或用 `--fetch-remote-workflow` 从 AutoDL 远端 `/root/ComfyUI/` 拉取内置的 `U00~U43` / `VRGDG` 原版工作流进行研究。**任何新工作流必须经真机运行验证通过后，才可沉淀进 `references/workflows/` 与 `references/scenarios/`，严禁凭空捏造未经验证的节点连线。**
> 2. **严禁私自关机（Mandatory User Confirmation for Power-Off）**：
>    * **Agent 绝不能在任务完成后私自调用 `--power-off` / `client.power_off()` 关机！**
>    * 必须先询问用户是否还有后续需求，**仅在用户明确回复确认关机后**，才允许传入 `--confirm`（或 `confirm=True`）执行关机。
> 3. **默认暂存输出与按需导出清理（Staging & Cleanup）**：
>    * 所有生成的图片和视频默认统一保存在 **`~/.shrimp/skills/leo-autodl-imagine-video/outputs/`** 暂存目录，不污染当前项目目录。
>    * 当用户选定最终满意的产物后，使用 `--export <文件名> --to <用户目标路径> --clean-others` 将其移至指定位置并清理无用的中间草稿。

---

## 2. 真实沉淀的知识库与工作流导航 (`references/`)

* **环境、OpenAPI 与远端工作流真实文件清单**：[references/autodl_env_and_api.md](references/autodl_env_and_api.md)
  * AutoDL 官方 OpenAPI 4 个已验证接口（`status`, `snapshot`, `power_on`, `power_off`）+ 远端 `ls` 实测抓回的 `VRGDG` 与 `U00~U43` 工作流完整文件名清单。
* **节点 Schema、云端模型真实清单与工作流探索方法**：[references/workflow_tuning_guide.md](references/workflow_tuning_guide.md)
  * 远端 `/object_info` 实测抓回的 `MiniMaxH3ReferenceToVideo` 完整参数定义、云端存在的 `minimax/*` 模型文件名清单，以及动态探索调优工作流的标准流程。
* **已实测验证的场景指南 (`references/scenarios/`)**：
  * [scenarios/image_gen_and_edit.md](references/scenarios/image_gen_and_edit.md) —— **场景 1：MiniMax-H3 生图实测记录与 `U33` 节点解析**
  * [scenarios/video_t2v_and_ref2v.md](references/scenarios/video_t2v_and_ref2v.md) —— **场景 2：MiniMax-H3 音画同步生视频实测记录（15 节点详解）**
* **已上机实测跑通的 API 工作流模板 (`references/workflows/`)**：
  * [workflows/minimax_h3_image_u33_api.json](references/workflows/minimax_h3_image_u33_api.json) —— 已在 RTX 5090 实测跑通的 9 节点生图工作流
  * [workflows/minimax_h3_video_1pass_api.json](references/workflows/minimax_h3_video_1pass_api.json) —— 已在 RTX 5090 实测跑通的 15 节点音画同步生视频工作流
* **可选参考资料与工作流/提示词备份库（供 Agent 按需查阅或跨镜像复用，非强制规范）**：
  * [workflows/u_series_api/](references/workflows/u_series_api/) —— 19 套 `API-U*.json` 工作流备份（标准 ComfyUI API 格式，内含 `_api_config` 参数说明，可直接通过 `--run-workflow` 运行）
  * [workflows/u_series_canvas/](references/workflows/u_series_canvas/) —— 61 套 `U00~U43` ComfyUI 网页画布原始工作流备份（供参考节点连线或导入其他镜像画布）
  * [prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md](references/prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md) —— `U00~U37` 各工作流的用途、输入与模型技术栈参考说明
  * [prompts_and_guides/minimax_h3_prompt_guide.json](references/prompts_and_guides/minimax_h3_prompt_guide.json) —— MiniMax-H3 分镜、运镜与角色对白提示词写法参考模板
  * [prompts_and_guides/minimax_h3_models_and_loras.json](references/prompts_and_guides/minimax_h3_models_and_loras.json) —— MiniMax-H3 常用底模、CLIP 与加速/风格 LoRA 列表参考

---

## 3. CLI 命令速查

```bash
PYTHON_BIN="$HOME/.shrimp/skills/leo-autodl-imagine-video/.venv/Scripts/python.exe"
# CLI_PATH 取当前 SKILL.md 所在目录下的 scripts/client.py（如 "$HOME/.agents/skills/leo-autodl-imagine-video/scripts/client.py"）
CLI_PATH="$HOME/.agents/skills/leo-autodl-imagine-video/scripts/client.py"

# 1. 探活 / 远程开机
& $PYTHON_BIN $CLI_PATH --probe --json
& $PYTHON_BIN $CLI_PATH --power-on --json

# 2. 查询云端 MiniMax-H3 模型清单 / 查询任意 ComfyUI 节点 Schema
& $PYTHON_BIN $CLI_PATH --list-models all --json
& $PYTHON_BIN $CLI_PATH --inspect-node MiniMaxH3ReferenceToVideo --json

# 3. 列出或拉取远端预置的成熟工作流原文件 (U00~U43 / VRGDG)
& $PYTHON_BIN $CLI_PATH --list-remote-workflows --json
& $PYTHON_BIN $CLI_PATH --fetch-remote-workflow "/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_audio_driven_builder_latent_upscale_2pass_api.json"

# 4. 执行已验证的 MiniMax-H3 生图工作流（默认暂存至 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/）
& $PYTHON_BIN $CLI_PATH --image \
  --prompt "A cinematic close-up portrait of a cyberpunk girl in neon rain, glowing blue eyes, 8k photorealistic masterpiece" \
  --width 1280 --height 736 --steps 12 --json

# 5. 执行已验证的 MiniMax-H3 音画同步生视频工作流（支持 --patch 动态调整任意节点字段）
& $PYTHON_BIN $CLI_PATH --video \
  --prompt "A sleek futuristic sports car speeding through neon rain, dynamic tracking shot, 8k cinematic" \
  --duration 3.0 --aspect-ratio "16:9" --steps 10 \
  --patch "174.inputs.reuse_threshold=0.15" --json

# 6. 直接运行任意自定义或拉取转换后的工作流 JSON
& $PYTHON_BIN $CLI_PATH --run-workflow "path/to/workflow.json" --json

# 7. 将用户选定的最终产物移至指定目录，并清理暂存目录中其余无用草稿
& $PYTHON_BIN $CLI_PATH --export "MiniMaxH3_Image_00001_.png" --to "D:/my-project/assets/" --clean-others --json

# 8. 【仅在用户明确确认同意关机后执行】远程关机停止计费
& $PYTHON_BIN $CLI_PATH --power-off --confirm --json
```
