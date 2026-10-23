# AutoDL 共创云环境、远端工作流真实目录清单与 OpenAPI 规范

本文档仅记录**经真机实测与命令抓取验证的客观事实**：包括 AutoDL 官方 OpenAPI 接口、远端服务器真实存在的目录与工作流文件名列表，以及操作铁律。

---

## 1. 核心行为铁律（Agent 必读）

> [!IMPORTANT]
> 1. **关机确认铁律（禁止私自关机）**：
>    * **任何 Agent 严禁在任务完成后私自调用 `--power-off` / `client.power_off()` 关机！**
>    * 必须先询问用户是否还有后续生成或调优需求，**仅在用户明确回复确认关机后**，才允许传入 `--confirm`（或 `confirm=True`）执行关机。
> 2. **暂存目录与按需导出清理规范**：
>    * 所有生成的图片和视频默认统一回传至 **`~/.shrimp/skills/leo-autodl-imagine-video/outputs/`** 暂存目录，不直接污染用户的项目工作区。
>    * 当用户选定最终满意的图片或视频后，使用 `--export <文件名> --to <目标路径> --clean-others` 将其移至用户指定目录，并清理无用的草稿文件。
> 3. **严禁凭空捏造工作流节点连线**：
>    * 凡是尚未拆解验证过的远端工作流或模型组合，Agent **必须先通过 `--fetch-remote-workflow` 下载远端原版 JSON 查看原作者真实节点连线，并在真机运行验证通过后**，才允许写入 `references/workflows/` 或场景文档，严禁根据文件名自行脑补连线。

---

## 2. AutoDL 远端预置工作流真实文件清单（`ls` 实测抓取）

远端实例（基于 `www.autodl.art` 创建，自动挂载 `/.autodl-model/data` 100TB 共享模型盘）在 `/root/ComfyUI/` 下有以下两个目录存放 MiniMax-H3 相关工作流。

### 2.1 VRGDG 官方 API 格式目录
路径：`/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/`
* **已下载并真机实测跑通**：
  * `minimax_built_in_audio_builder_api.json`（已保存至本地 `references/workflows/minimax_h3_video_1pass_api.json`，仅修复了节点 `141` 模型路径前缀 `minimax/`，真机实测产出带声音 MP4）。
* **远端存在但尚未拆解验证的同目录文件**（后续如需使用，请先用 `--fetch-remote-workflow` 下载分析并实测）：
  * `minimax_audio_driven_builder_api.json`
  * `minimax_audio_driven_builder_normal_2pass_api.json`
  * `minimax_audio_driven_builder_latent_upscale_2pass_api.json`
  * `minimax_ref2video_2pass_audio_driven_api.json`
  * `minimax_ref2video_3pass_audio_driven_api.json`

### 2.2 社区工作流目录 (`U视频-MINIMAX-H3`)
路径：`/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/`
> **注意**：以下文件为 ComfyUI 前端 UI 保存格式（含 `nodes` 与 `links` 数组，非直接提交 `/prompt` 的 API 字典格式）。
* **已读取内部节点并提炼实测跑通**：
  * `U33-Minimax-H3图像编辑全能工作流.json`（已提炼其单图生成核心节点 `Node 1~9` 保存至 `references/workflows/minimax_h3_image_u33_api.json`，并在真机实测生成 1280x736 PNG 图片）。
* **远端客观存在但仅获取了文件名、尚未读取内部 JSON 的工作流文件清单**（共 42 个，按原文件名列出，供后续按需拉取研究）：
  * `U00-minimax_h3提示词QWEN3.8群主版.json` / `U00-minimax_h3提示词QWEN3.8群主版V3.json` / `U00-selflift群主随便耍耍版.json`
  * `U01-minimax_h3_多图参考生视频基础版.json` / `U01-minimax_h3_light2v多图参考生视频加速版.json`
  * `U02-minimax_h3_图生视频基础版.json` / `U02-minimax_h3_lightX2v首尾帧图生视频加速版V2.json`
  * `U03-minimax_h3_文生视频基础版.json` / `U03-minimax_h3_light2v-文生视频加速版.json`
  * `U04-minimax_h3_5图参考生视频30步版.json` / `U04-minimax_h3_light2v-5图参考生视频加速版.json`
  * `U05-MiniMax-H3-一键视频换装.json` / `U05-MiniMax-H3-数字人视频带货-多图生视频.json` / `U05-minimax_h3-多参考图light2v加速生成-LTX超分.json`
  * `U06-minimax_h3_lightX2v多图参考生视频V5.json` / `U06-minimax_h3_多图参考生视频V6.json` / `U06-minimax_h3_多图参考生视频V9.json`
  * `U07-MiniMax-H3全能参考工作流Work-Fisher.json`
  * `U08-MiniMax-H3-极速生成10S只要2分半.json`
  * `U09-Minimax-H3二采重绘单模型极速版wuwukasi-V3.json` / `U09-Minimax-H3二采重绘双模型极速版wuwukasi-V4.json`
  * `U11-Minimax-H3-图生视频-音频同步V2.json`
  * `U12-minimax_h3-全能无加速-可选超分.json`
  * `U13-MiniMaxH3-黑鹤加速视频流整合.json`
  * `U17-MiniMax-H3-latent放大模型双采加速-高动态不糊-去油腻-修音频-全能工作流.json`
  * `U18-MiniMax-H3-Remix-FeiHou-Easy-H3-二次采样工作流v2.json`
  * `U19-MiniMax-H3-Director导演台二采加速.json`
  * `U20-MiniMax-H3-FL2VA-REF2VA-极致高动态-四只兔子.json` / `U20-MiniMax-H3-激烈战斗动作连续性-四只兔子.json`
  * `U21-H3视频生成双显卡加速-非双显卡勿用.json` / `U21-H3视频生成双显卡加速-非双显卡勿用V2.json`
  * `U22-YZ金鱼-MiniMaxH3终极篇-文武双全.json`
  * `U23-MiniMaxH3-南风V15.json`
  * `U24-文武双修T8版MiniMaxH3双采参考生视频V2.json` / `U24-文武双修T8版MiniMaxH3双采参考生视频V927.json`
  * `U25-Singularity-Vdn文戏版-MiniMaxH3单采极速参考生视频V2-T8.json`
  * `U26-MiniMax-H3智能一体化视频创作V3-孤海.json`
  * `U27-MinimaxH3纹理增强-爱屋.json`
  * `U28-双采数字人-self-lift工作流-爱屋.json` / `U28-黑科技加速双采-self-lift工作流-爱屋.json`
  * `U29-H3高动态多图版-宫格图反推写词-小岚-扣群868450976.json`
  * `U30-Minimax-H3-Singularity超双采放大-AIGC特异点.json` / `U30-Minimax-H3-Singularity超双采放大-AIGC特异点V2.json`
  * `U31-H3动作替换迁移.json`
  * `U32-Minimax-H3-1080P-高动态不糊-BUNNY-SelfLift.json`
  * `U34-WORK-FISHER-9-28-MINIMAXH3-武戏高动态工作流.json`
  * `U35-H3官流-单采文戏-神棍.json` / `U35-H3官流-最强武戏-神棍.json` / `U35-H3官流-终极版-神棍.json`
  * `U36-FeiHouEasyH3二段式采样v6.json`
  * `U37-真-上下文无缝无色差长视频-SelfLift双采-惊尘573.json`
  * `U38-打斗增强版-多少会点不精.json`
  * `U39-吃猪侠233-2采.json` / `U39-吃猪侠233-H3无损融合单采.json` / `U39-吃猪侠233单采V2-33步雷霆祭祀版.json`
  * `U40-万物皆可接续-最终版-阿喵喵Az.json`
  * `U41-H3无缝衔接无限时长工作流.json`
  * `U42-H3多参一次跑出60秒非拼接流.json`
  * `U43-Minimax-H3-多人动作迁移完结篇-Aiden_0.json`

---

## 3. AutoDL 官方开发者 OpenAPI 协议规范（已实测验证）

* **API Base URL**：`https://www.autodl.art`
* **Headers**：`{"Authorization": "<JWT_TOKEN>", "Content-Type": "application/json"}`
* **本地配置路径**：`~/.shrimp/skills/leo-autodl-imagine-video/config.json`

| 功能 | HTTP 方法与端点 | 请求参数 / Body | 实测响应核心字段 |
| :--- | :--- | :--- | :--- |
| **查询实例状态** | `GET /api/v1/adl_dev/dev/instance/pro/status?instance_uuid={uuid}` | Query: `instance_uuid` | `data`: `"running"` / `"shutdown"` / `"starting"` |
| **刷新动态 SSH 凭证** | `GET /api/v1/adl_dev/dev/instance/pro/snapshot?instance_uuid={uuid}` | Query: `instance_uuid` | `data.proxy_host`, `data.ssh_port`, `data.root_password` |
| **远程有卡开机** | `POST /api/v1/adl_dev/dev/instance/pro/power_on` | `{"instance_uuid": "<uuid>", "payload": "gpu"}` | `code: "Success"`（开机后自动调用 `snapshot` 更新端口） |
| **远程关机停止计费** | `POST /api/v1/adl_dev/dev/instance/pro/power_off` | `{"instance_uuid": "<uuid>"}` | `code: "Success"`（**必须先获用户确认**） |
