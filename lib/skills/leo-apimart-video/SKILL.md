---
name: leo-apimart-video
description: 对接 APIMart 视频生成接口（/v1/videos/generations），支持 Grok、Seedance、VEO3、Kling、Hailuo、Wan、Vidu、Pixverse 等 40+ 视频模型的文生视频、图生视频（本地参考图自动上传）、异步任务轮询、断点续查与 mp4 自动落盘。
---

# APIMart 视频生成 (`leo-apimart-video`)

单一职责：只对接 APIMart 视频生成。生图请用 `leo-codex-imagine`。

零依赖，Node 18+，网络请求走系统 `curl`（自动遵循 `https_proxy`）。
配置：`~/.shrimp/skills/leo-apimart-video/config.json`（权限 600）。

## 目录结构
```
scripts/
  leo_apimart_video.mjs   # CLI：参数解析、命令分发、结果汇报
  lib/
    operations.mjs        # 提交类接口注册表（generate / remix）+ 请求体构建  ← 扩展点
    task.mjs              # task_id 解析、轮询、结果归一化 {videos, images, text}、落盘
    http.mjs              # curl 请求（Key 走 0600 头文件）、图片上传、下载
    tunnel.mjs            # 本地视频/音频 → 临时公网链接（只暴露指定文件 + cloudflared 临时隧道）
    config.mjs            # 配置读写、Key 脱敏
```
**新增一个提交接口** = 在 `lib/operations.mjs` 的 `OPERATIONS` 里加一项 `{ summary, path(args), positional?, requireModel? }`，再在本文件加一行说明；CLI、dry-run、幂等键、轮询、下载全部复用。
**新增一种结果类型** = 改 `task.mjs` 的 `collectOutputs` / `planOutputFiles`。

```bash
S=~/.agents/skills/leo-apimart-video/scripts/leo_apimart_video.mjs
node $S config set --api-key "sk-..."              # 首次配置
node $S config set --default-model grok-imagine-1.5-video-ext
node $S config get                                  # Key 自动脱敏
```

---

## 接口要点（来自 docs.apimart.ai，2026-10 核对）
| 命令 | 接口 | 用途 |
|------|------|------|
| `generate`（默认） | `POST /videos/generations` | 所有视频模型的文生 / 图生 / 参考生成；也包括 `MiniMax-H3-Context-IR`（只返回增强提示词） |
| `remix <task_id>` | `POST /videos/{task_id}/remix` | VEO3.1 续写（8s → 15s），`model` 必须与原任务一致，原任务须已完成 |
| `status <task_id>` | `GET /tasks/{task_id}` | 查询 / 续等并下载 |
| `upload <path>` | `POST /uploads/images` | 本地图片换 URL（72 小时有效） |

- 提交返回 `{"code":200,"data":[{"task_id":"...","status":"submitted"}]}`；状态 `submitted / pending / processing → completed | failed | cancelled`
- 完成结果按类型落盘：`result.videos[].url` → mp4（可能多个，如 `muse-video-ext` 的 `n`）；`result.images[].url` → 图片；`result.prompt` → `.txt`（Context-IR）
- **视频链接约 24 小时有效**，脚本完成后立即下载
- **参考图不接受 base64**：`--images` 的本地文件会自动走上传接口换 URL
- **APIMart 只有图片上传接口**：`video_urls` / `audio_urls` 等参考视频、音频要求公网 URL。没有公网服务器时，直接在 `--set` 里写本地路径即可，脚本会自动：
  1. 起一个只暴露这些文件的本地服务（路径带 32 位随机 token，目录里其他文件不可访问）；
  2. 用 `cloudflared` 申请 Cloudflare 临时隧道（免账号、免公网 IP），替换成 `https://<随机>.trycloudflare.com/...`；
  3. 隧道保持到任务完成（APIMart 可能在处理中途才拉取文件），然后自动关闭。
  - 需要先安装：`brew install cloudflared`
  - 隧道开着期间，拿到链接的人都能下载这些文件；私密素材慎用
  - 不能与 `--no-wait` 同用；隧道无可用性保证，失败时重试或改用对象存储签名链接
  - 已知网络坑：`api.trycloudflare.com` 偶发超过 cloudflared 的 15 秒超时（实测约 1/3），脚本会自动重试 3 次
  - 只对 Grok `video_urls` 等不收 base64 的字段有必要；`gemini-omni-flash-preview`、`flux-3-video` 的视频字段本身接受 base64
- **幂等键**：每次提交自动带 `Idempotency-Key`（UUID，会打印出来）。网络失败 / 5xx / 409 等结果不确定时，用 `--idempotency-key <同一个>` 和完全相同的参数重试，不会重复扣费；文档明确支持的是 Grok 官方模型和 Muse，其他模型会忽略该头
- 各模型参数名不统一（比例有的叫 `size`，有的叫 `aspect_ratio`；首帧有的叫 `first_frame_image`），**以模型文档为准**
- 未验证：Kling V4 / Pixverse V6 Max 文档写的查询地址是 `GET /videos/generations/{id}`，脚本统一用 `/tasks/{id}`；如查询失败，在 `task.mjs` 的 `getTask` 处按模型切换
- 不在本 skill 范围：Seedance 私有虚拟人素材（`/seedance2/private-avatar`）、Midjourney 图生视频（`/midjourney/generations/video`）

## Agent 工作流（必须遵守）
1. 用户没指定模型 → 把下面的模型表给用户挑，不要替用户选（不同模型价格差异大）。
2. 第一次用某个模型 → 先读它的文档确认字段：`curl -sSL <文档链接>`（链接即 `.md`，可直接读）。
3. 先 `--dry-run` 核对请求体，再正式提交。
4. 视频通常要几分钟。默认会阻塞轮询（最长 30 分钟）；超时或用了 `--no-wait` 时，之后用 `status <task_id>` 续查并下载。

## 用法
```bash
# 文生视频（Grok：比例用 --size）
node $S --model grok-imagine-1.5-video-ext --prompt "海边奔跑的小狗，慢动作" --size 16:9 --duration 6 --resolution 720p

# 图生视频：本地图自动上传，URL 原样透传
node $S --model grok-imagine-1.5-video-ext --prompt "让画面动起来" --images ./cat.jpg,https://example.com/ref.png

# 模型专属字段用 --set（值按 JSON 解析）
node $S --model kling-v3 --prompt "..." --aspect-ratio 16:9 --set mode=pro --set audio=true

# 参考视频 / 音频用本地文件：自动经临时隧道提供（需 cloudflared）
node $S --model seedance-2.0 --prompt "参考视频的运镜" --size 16:9 --set video_urls='["./ref.mp4"]' --set audio_urls='["./bgm.mp3"]'

# 字段不是 image_urls 的模型（如 Hailuo 首帧）：先 upload 拿 URL，再 --set
URL=$(node $S upload ./first.png)
node $S --model MiniMax-Hailuo-2.3 --prompt "..." --set first_frame_image="$URL"

# VEO3.1 续写（model 与原任务一致）
node $S remix task_01XXXX --model veo3.1-fast --prompt "猫继续在草地上奔跑" --aspect-ratio 16:9 --set raw=false

# MiniMax-H3 两步：先 Context-IR 增强提示词（存为 .txt），再生成
node $S --model MiniMax-H3-Context-IR --prompt "宇航员推开舱门看到太空花园" --filename h3_prompt
node $S --model MiniMax-H3 --prompt "$(cat videos/h3_prompt.txt)" --aspect-ratio 16:9

# 提交失败且提示结果不确定：带同一个幂等键原样重试
node $S --model grok-imagine-video --prompt "..." --idempotency-key 7d0141e4-a19a-4650-a717-dab777b3a330

# 只提交 / 续查
node $S --model veo3.1-fast --prompt "..." --aspect-ratio 16:9 --no-wait
node $S status task_01JNXXXX --output-dir ./videos

# 预检（不上传、不扣费）
node $S --model seedance-2.0 --prompt "..." --size 16:9 --duration 5 --dry-run
```

## 参数
| 参数 | 写入字段 / 作用 |
|------|------|
| `--model` | `model`（缺省用 `default_model`） |
| `--prompt` | `prompt`（绝大多数模型必填；`MiniMax-H3-Regeneration` 可省） |
| `--size` | `size` |
| `--aspect-ratio` | `aspect_ratio` |
| `--duration` | `duration`（转成数字，API 拒绝带引号的值） |
| `--resolution` | `resolution` |
| `--images a,b` | `image_urls`（本地文件自动上传） |
| `--set key=value` | 任意字段，可多次，覆盖以上同名字段；值里的本地文件路径自动经临时隧道变成公网链接 |
| `--idempotency-key` | 重试时复用上次打印的幂等键（默认每次新生成） |
| `--output-dir` / `--filename` | 保存位置，默认 `./videos/apimart_<提示词>_<时间>.mp4`；多个结果自动加 `_1 _2` |
| `--no-wait` | 只提交（不能与本地视频/音频同用） |
| `--dry-run` | 只打印请求体 |
| `--api-key` / `--api-url` | 临时覆盖配置 |

---

## 模型速查（比例字段 = 传 `--size` 还是 `--aspect-ratio`）
文档前缀：`https://docs.apimart.ai/en/api-reference/videos/`

| 系列 | model 取值 | 比例字段 | 文档 |
|------|-----------|---------|------|
| Grok Imagine 1.5 | `grok-imagine-1.5-video-ext` | size（16:9/9:16/1:1/3:2/2:3；6–15s；480p/720p） | `grok-imagine/generation.md` |
| Grok 官方 | `grok-imagine-video` `grok-imagine-video-1.5` | aspect_ratio | `grok-imagine/official.md` |
| Seedance 1.0 | `seedance-1-0-pro-fast` `seedance-1-0-pro-quality` | aspect_ratio | `doubao/generation.md` |
| Seedance 1.5 | `seedance-1-5-pro` | aspect_ratio | `seedance-1-5-pro/generation.md` |
| Seedance 2.0 | `seedance-2.0` `seedance-2.0-fast` `seedance-2.0-mini` | size | `seedance-2-0/generation.md` |
| Seedance 2.5 | `seedance-2.5` | size | `seedance-2-5/generation.md` |
| VEO3.1 | `veo3.1-fast` `veo3.1-quality` `veo3.1-lite`（及 `-ext`） | aspect_ratio | `veo3/generation.md` |
| VEO3.1 Remix（`remix` 命令） | `veo3.1-fast` `veo3.1-quality`（及 `-ext`） | aspect_ratio（16:9/9:16） | `veo3/remix.md` |
| VEO3.1 官方 | `veo3.1-fast-official` `veo3.1-quality-official` | aspect_ratio | `veo3/generation-official.md` |
| Hailuo 02 | `MiniMax-Hailuo-02` | 无 | `minimax-hailuo/generation.md` |
| Hailuo 2.3 | `MiniMax-Hailuo-2.3` `MiniMax-Hailuo-2.3-Fast`（首帧 `first_frame_image`） | 无 | `minimax-hailuo-2.3/generation.md` |
| MiniMax H3 | `MiniMax-H3` / `minimax-h3-max` | aspect_ratio | `minimax-h3/generation.md` `minimax-h3/max.md` |
| MiniMax H3 辅助 | `MiniMax-H3-Context-IR`（只出提示词）/ `MiniMax-H3-Regeneration`（768P→2K，`--set source_task_id=...`） | — | `minimax-h3/context-ir.md` `minimax-h3/regeneration.md` |
| FLUX 3 Video | `flux-3-video` | aspect_ratio | `flux-3-video/generation.md` |
| SkyReels V4 | `skyreels-v4-fast` `skyreels-v4-std` | aspect_ratio | `skyreels-v4/generation.md` |
| HappyHorse | `happyhorse-1.0` `happyhorse-1.1` | size | `happyhorse-1.0/generation.md` `happyhorse-1.1/generation.md` |
| Wan 3.0 | `wan3.0-video` `wan3.0-video-prime` | size | `wan3.0-video/generation.md` |
| Wan 2.7 | `wan2.7` / `wan2.7-r2v` / `wan2.7-videoedit` | size | `wan2.7/generation.md` `wan2.7-r2v/generation.md` `wan2.7-videoedit/generation.md` |
| Wan 2.6 | `wan2.6` / `wan2.6-i2v-flash` | aspect_ratio / 无 | `wan2.6/generation.md` `wan2.6/i2v-flash-generation.md` |
| Wan 2.5 | `wan2.5-preview` | size | `wan2.5/generation.md` |
| Kling | `kling-v2-6` `kling-v3` `kling-3.0-turbo` `kling-v3-omni` `kling-v4` `kling-video-o1` | aspect_ratio | `kling-v2-6/` `kling-v3/` `kling-3.0-turbo/` `kling-v3-omni/` `kling-v4/` `kling-video-o1/` + `generation.md` |
| Kling 动作控制 | `kling-v2-6-motion-control` `kling-v3-motion-control` | 无 | `kling-v2-6/kling-v2-6-motion-control-generation.md` |
| Vidu | `viduq3-pro` `viduq3-turbo` / `viduq3` `viduq3-mix` / `viduq4-preview` | aspect_ratio | `vidu-q3-pro/` `vidu-q3/` `vidu-q4-preview/` + `generation.md` |
| Pixverse | `pixverse-v6` / `pixverse-v6-max` | size / aspect_ratio | `pixverse-v6/generation.md` `pixverse-v6-max/generation.md` |
| Gemini Omni | `gemini-omni-1.1-flash` `gemini-omni-flash-preview` `gemini-omni-1.1-flash-ext` | aspect_ratio | `gemini-omni-1.1-flash/` `gemini-omni-flash-preview/` `omni-flash-ext/` + `generation.md` |
| Muse Video Ext | `muse-video-ext` | aspect_ratio | `muse-video-ext/generation.md` |

模型列表会变，最新完整索引：`https://docs.apimart.ai/_llms/en/api-manual.txt`（搜索 `videos/`）。
