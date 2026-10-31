# hypit

仓库：https://github.com/hypit-ai/hypit

## 适合

- 生成优先的社媒视频：UGC 口播、短剧、双人播客、街头采访、排行榜、讲解员 + MG、旁白带货。
- 复刻社媒真人表演类参考视频。
- 以词为锚的时间轴，Studio 里可视化修改。

## 不适合

- 只加工已有素材 → 交给 OpenMontage。
- 不想付费调用生成模型。

## 安装

- `npx skills add hypit-ai/hypit -g -y`
- 首次使用时它会检查并协助安装 Hypit 可执行程序。

## 交接

- 从 `python3 <本 skill 目录>/scripts/registry.py locate hypit`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）输出的 `entry_dir` 读其 SKILL.md 并按它执行。
- 生成模型通过 HypiHub 或用户自己的 API Key 接入，付费前它会和用户确认预算。

## 音频

- 内生（ElevenLabs、FishAudio、MiMo，支持音色克隆）。
- 用户提供的录音可作为表演音轨或克隆参考；omnivoice 生成的音频按「用户提供的录音」交给它。
- AI 人物开口说话的镜头不替换音频。

## 注意

- 需要词级时间时它用 WhisperX。
