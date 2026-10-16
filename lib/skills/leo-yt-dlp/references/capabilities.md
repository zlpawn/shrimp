# yt-dlp 进阶能力与参数速查指南

## 1. 工具生命周期管理 (uv tool)

根据项目 `lib/skills/README.md` 原则 2，全面使用 `uv tool` 管理 `yt-dlp`，避免全局环境污染并实现快速版本自愈：

- **安装**：`uv tool install yt-dlp`
- **升级 / 自愈**：`uv tool upgrade yt-dlp`
- **版本检查**：`yt-dlp --version`

---

## 2. 视频与音频流选择器 (Format Selector)

- `-f "bv*+ba/b"`：默认最高画质组合（最佳视频流 + 最佳音频流，若无分离流则回退为单一最高质量流）。
- `-f "ba/b" -x --audio-quality 0`：提取最高品质音频，不进行有损压制。
- 显式分辨率指定：
  - `-f "bestvideo[height<=1080]+bestaudio/best[height<=1080]"`：限制最高 1080P。
  - `-f "bestvideo[height<=2160]+bestaudio/best[height<=2160]"`：限制最高 4K。
- 编解码过滤：
  - 首选 H.264/AVC 兼容性：`-f "bv*[vcodec^=avc]+ba/b"`
  - 首选 AV1 高效编码：`-f "bv*[vcodec^=av01]+ba/b"`

---

## 3. 辅助资产与元数据

- **元数据嵌入**：`--embed-metadata`（将标题、作者、发布日期等写入媒体容器）。
- **封面图处理**：
  - 保存封面文件：`--write-thumbnail`
  - 嵌入视频/音频文件内：`--embed-thumbnail`
- **元数据 JSON**：`--write-info-json`（生成 sidecar `.info.json` 文件供后续检索分析）。
- **字幕处理**：
  - 自动字幕与人工字幕：`--write-subs --write-auto-subs`
  - 语言过滤：`--sub-langs "zh-Hans,zh-Hant,en,all,-live_chat"`
  - 字幕转码：`--convert-subs srt`
  - 仅下载字幕：`--skip-download`
- **分章节处理**：
  - 嵌入章节标记：`--embed-chapters`
  - 按章节分割文件：`--split-chapters`

---

## 4. 播放列表与增量归档

- **增量下载归档**：`--download-archive "archive.txt"`（记录已下载 ID，避免重复下载）。
- **范围限制**：`--playlist-items 1:10`（仅前 10 个视频）。
- **倒序下载**：`--playlist-reverse`。
- **日期过滤**：`--dateafter today-7days`（下载最近 7 天发布的视频）。

---

## 5. 网络与鉴权控制

- **使用 Netscape 格式 Cookie 文件**：`--cookies "path/to/cookies.txt"`
- **直接从浏览器读取（备用）**：`--cookies-from-browser chrome`（注意 Windows 上可能因文件锁冲突）
- **代理支持**：`--proxy "http://127.0.0.1:7890"` 或 `--proxy "socks5://127.0.0.1:1080"`
- **限速与重试**：`--limit-rate 5M --retries 10 --fragment-retries 10`
