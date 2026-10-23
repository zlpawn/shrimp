# AutoDL 共创云环境、预置成熟工作流库与 OpenAPI 规范

本文档记录了我们在 **AutoDL 共创云 (`www.autodl.art`)** 部署的 ComfyUI + MiniMax-H3 镜像环境、远端内置的 40+ 个成熟工作流索引，以及实例生命周期 OpenAPI 协议。

---

## 1. 核心行为铁律（Agent 必读）

> [!IMPORTANT]
> 1. **关机确认铁律（禁止私自关机）**：
>    * **任何 Agent 严禁在任务完成后私自调用 `--power-off` / `client.power_off()` 关机！**
>    * 必须先询问用户是否还有后续生成或调优需求，**仅在用户明确回复确认关机后**，才允许传入 `--confirm`（或 `confirm=True`）执行关机。
> 2. **暂存目录与按需导出清理规范**：
>    * 所有生成的图片和视频默认统一回传至 **`~/.shrimp/skills/leo-autodl-imagine-video/outputs/`** 暂存目录，不直接污染用户的项目工作区。
>    * 当用户选定最终满意的图片或视频后，使用 `--export <文件名> --to <目标路径> --clean-others` 将其移至用户指定目录，并清理无用的草稿文件。

---

## 2. AutoDL 远端环境与预置成熟工作流宝库

我们的实例从 `https://www.autodl.art` 创建，自动挂载了 **100TB 共享模型盘 (`/.autodl-model/data`)**，且镜像内的 `/root/ComfyUI/` 已经预置了大量社区与官方验证成熟的 **MiniMax-H3 工作流**。

Agent 可随时通过 `--list-remote-workflows` 查看、或通过 `--fetch-remote-workflow "<远端路径>"` 下载任意工作流进行分析与沉淀：

### 2.1 VRGDG 官方 API 格式工作流（可直接或微调提交 `/prompt`）
位于 `/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/`：
* `minimax_built_in_audio_builder_api.json` —— **单采音画同步标准流**（已沉淀至本地 `references/workflows/minimax_h3_video_1pass_api.json`）
* `minimax_audio_driven_builder_normal_2pass_api.json` —— **音频驱动二次采样标准流**
* `minimax_audio_driven_builder_latent_upscale_2pass_api.json` —— **潜空间超分放大二次采样流**（适合解决单采画面模糊）
* `minimax_ref2video_2pass_audio_driven_api.json` —— **多参考图二次采样音画流**
* `minimax_ref2video_3pass_audio_driven_api.json` —— **多参考图三次采样极致精修流**

### 2.2 社区精调场景工作流库 (`U00 ~ U43`)
位于 `/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/`，按场景分类如下：

| 业务场景 | 远端成熟工作流文件名 | 核心特点与适用时机 |
| :--- | :--- | :--- |
| **生图 / 多图编辑 / 宫格分镜板** | `U33-Minimax-H3图像编辑全能工作流.json` | **生图主力流**（已提炼沉淀至本地 `minimax_h3_image_u33_api.json`），支持单张写实生图、最多 9 张参考图锁脸换装、5 宫格电影剧照分镜板 |
| **基础文生视频 / 多图生视频** | `U01-minimax_h3_多图参考生视频基础版.json`<br/>`U03-minimax_h3_文生视频基础版.json`<br/>`U11-Minimax-H3-图生视频-音频同步V2.json` | 简洁稳定，适合首轮快速验证分镜与音画同步 |
| **首尾帧过渡生视频** | `U02-minimax_h3_lightX2v首尾帧图生视频加速版V2.json`<br/>`U20-MiniMax-H3-FL2VA-REF2VA-极致高动态-四只兔子.json` | 使用 `fl2va` 模型，给定首帧与尾帧生成丝滑运镜过渡 |
| **高清二采 / 去油腻 / 防模糊** | `U17-MiniMax-H3-latent放大模型双采加速-高动态不糊-去油腻-修音频-全能工作流.json`<br/>`U18-MiniMax-H3-Remix-FeiHou-Easy-H3-二次采样工作流v2.json`<br/>`U32-Minimax-H3-1080P-高动态不糊-BUNNY-SelfLift.json` | 当用户反馈“单采画面有点糊、人物皮肤有塑料油腻感”时，参考或切换至此系列二采流 |
| **高动态武戏 / 激烈打斗** | `U20-MiniMax-H3-激烈战斗动作连续性-四只兔子.json`<br/>`U34-WORK-FISHER-9-28-MINIMAXH3-武戏高动态工作流.json`<br/>`U35-H3官流-最强武戏-神棍.json` | 针对大幅度动作、格斗、高速追逐专门调优的采样与模型组合 |
| **细腻文戏 / 台词表演 / 数字人** | `U25-Singularity-Vdn文戏版-MiniMaxH3单采极速参考生视频V2-T8.json`<br/>`U35-H3官流-单采文戏-神棍.json`<br/>`U05-MiniMax-H3-数字人视频带货-多图生视频.json` | 针对人物微表情、眼神交流、口型台词同步专门优化 |
| **长视频无缝续写** | `U37-真-上下文无缝无色差长视频-SelfLift双采-惊尘573.json`<br/>`U41-H3无缝衔接无限时长工作流.json` | 适合多镜头长视频续写，消除首尾衔接色差 |

---

## 3. AutoDL 官方开发者 OpenAPI 协议规范

* **API Base URL**：`https://www.autodl.art`
* **Headers**：`{"Authorization": "<JWT_TOKEN>", "Content-Type": "application/json"}`
* **本地配置路径**：`~/.shrimp/skills/leo-autodl-imagine-video/config.json`

| 功能 | HTTP 方法与端点 | 请求参数 / Body | 响应核心字段 |
| :--- | :--- | :--- | :--- |
| **查询实例状态** | `GET /api/v1/adl_dev/dev/instance/pro/status?instance_uuid={uuid}` | Query: `instance_uuid` | `data`: `"running"` / `"shutdown"` / `"starting"` |
| **刷新动态 SSH 凭证** | `GET /api/v1/adl_dev/dev/instance/pro/snapshot?instance_uuid={uuid}` | Query: `instance_uuid` | `data.proxy_host`, `data.ssh_port`, `data.root_password` |
| **远程有卡开机** | `POST /api/v1/adl_dev/dev/instance/pro/power_on` | `{"instance_uuid": "<uuid>", "payload": "gpu"}` | `code: "Success"`（开机后自动调用 `snapshot` 更新端口） |
| **远程关机停止计费** | `POST /api/v1/adl_dev/dev/instance/pro/power_off` | `{"instance_uuid": "<uuid>"}` | `code: "Success"`（**必须先获用户确认**） |
