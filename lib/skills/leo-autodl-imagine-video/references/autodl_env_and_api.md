# AutoDL 共创云环境路径与官方 OpenAPI 协议规范

本文档记录经真机实测验证的 AutoDL 官方 OpenAPI 接口与云端环境路径。

---

## 1. AutoDL 官方开发者 OpenAPI 协议规范

* **API Base URL**：`https://www.autodl.art`
* **Headers**：`{"Authorization": "<JWT_TOKEN>", "Content-Type": "application/json"}`
* **本地配置路径**：`~/.shrimp/skills/leo-autodl-imagine-video/config.json`

| 功能 | HTTP 方法与端点 | 请求参数 / Body | 实测响应核心字段 |
| :--- | :--- | :--- | :--- |
| **查询实例状态** | `GET /api/v1/adl_dev/dev/instance/pro/status?instance_uuid={uuid}` | Query: `instance_uuid` | `data`: `"running"` / `"shutdown"` / `"starting"` |
| **刷新动态 SSH 凭证** | `GET /api/v1/adl_dev/dev/instance/pro/snapshot?instance_uuid={uuid}` | Query: `instance_uuid` | `data.proxy_host`, `data.ssh_port`, `data.root_password` |
| **远程有卡开机** | `POST /api/v1/adl_dev/dev/instance/pro/power_on` | `{"instance_uuid": "<uuid>", "payload": "gpu"}` | `code: "Success"`（开机后自动调用 `snapshot` 更新端口） |
| **远程关机停止计费** | `POST /api/v1/adl_dev/dev/instance/pro/power_off` | `{"instance_uuid": "<uuid>"}` | `code: "Success"`（完整视频完成后可自动关机；中途/生图阶段须先获用户确认） |

---

## 2. 云端实例核心目录结构

* **ComfyUI 根目录**：`/root/ComfyUI/`（服务端口：`127.0.0.1:6006`）
* **参考素材上传目录**：`/root/ComfyUI/input/`
* **生成结果输出目录**：`/root/ComfyUI/output/`
* **VRGDG 官方 API 工作流目录**：`/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/`
  * `minimax_built_in_audio_builder_api.json`（已验证并保存至本地 `references/workflows/minimax_h3_video_1pass_api.json`）
  * `minimax_audio_driven_builder_api.json`
  * `minimax_audio_driven_builder_normal_2pass_api.json`
  * `minimax_audio_driven_builder_latent_upscale_2pass_api.json`
  * `minimax_ref2video_2pass_audio_driven_api.json`
  * `minimax_ref2video_3pass_audio_driven_api.json`
* **云端预置 U 系列工作流目录**：
  * 画布 UI 格式：`/root/ComfyUI/user/default/workflows/U视频-MINIMAX-H3/`（已全量备份至本地 `references/workflows/u_series_canvas/`）
  * API 节点格式：`/root/zealman-app/workflows/API-U*.json`（已全量备份至本地 `references/workflows/u_series_api/`）
