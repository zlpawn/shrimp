# musicdl 进阶能力与参数速查指南

## 1. 工具生命周期管理 (uv tool)

根据项目规范（`lib/skills/README.md` 原则 2），全面采用 `uv tool` 独立沙箱管理 `musicdl`：

- **安装**：`uv tool install musicdl`
- **升级 / 自愈**：`uv tool upgrade musicdl`
- **版本检查**：`musicdl --version`

---

## 2. 核心参数与来源配置

- **关键词搜索**：`-k, --keyword "<歌曲名/歌手/专辑>"`
  - 跳过初始交互，直接拉取多平台匹配结果并渲染候选列表表格。
- **歌单解析下载**：`-p, --playlist-url "<歌单链接>"`
  - 自动解析网易云/QQ音乐等公开歌单并批量下载整单曲目。
- **指定音乐源优先级**：`-m, --music-sources "<源列表>"`
  - 默认优选源：`QQMusicClient,NeteaseMusicClient`
  - 全量备选源：`MiguMusicClient,NeteaseMusicClient,QQMusicClient,KuwoMusicClient,QianqianMusicClient`
- **工作目录与配置**：`-i, --init-music-clients-cfg '{"work_dir": "D:\\素材\\音乐\\_musicdl_tmp"}'`
  - 控制各平台客户端的下载临时工作区，避免在根目录生成深层时间戳文件夹。

---

## 3. 文件格式与清洗规则

- **优先无损/高码率**：保留 `.flac`、高码率 `.mp3`（320k）、`.m4a` 或 `.wav`。
- **拦截加密格式**：若平台返回专属加密格式（如 `.mgg` / `.mflac`），移入 `_musicdl_tmp\unsupported_formats` 并自动寻找其他可用音源。
- **扁平化整理**：下载完成后，将文件从 `_musicdl_tmp` 移动至 `D:\素材\音乐`，保持目录整洁。

---

## 4. 联动与兜底策略 (Fallback)

- 若各大音乐平台因版权下架或 VIP 限制无法下载：
  - 联动 **[`leo-yt-dlp`](file:///D:/agent-transfer/lib/skills/leo-yt-dlp)**：从 B 站（官方 MV/现场 Live）或 YouTube 抽取最佳品质纯音频（`-f "ba/b" -x --audio-quality 0`）。
