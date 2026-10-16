---
name: leo-musicdl
description: 使用 musicdl 进行多源高品质音乐搜索、单曲/专辑/歌单批量下载、歌词与封面匹配。集成 uv tool 工具链实现极速安装与自动升级，遵循 QQ音乐与网易云双优选源策略，支持临时目录隔离与格式清洗，并在版权受限时自动联动 leo-yt-dlp 兜底提取。当用户提出搜索或下载歌曲、歌单、无损音乐、伴奏或修复 musicdl 报错时触发。
---

# Leo musicdl 音乐搜索与批量下载技能

本技能负责全网多平台高品质音乐的精准搜索、歌单解析、音质甄别与批量拉取，全面采用 `uv tool` 独立沙箱管理，具备下载文件自动扁平化整理和版权受限时的联动兜底机制。

---

## 1. 环境就绪与版本自愈 (uv tool)

遵循项目开发规范（`lib/skills/README.md` 原则 2），采用 `uv tool` 独立沙箱管理 `musicdl`：

- **版本自检**：
  ```powershell
  musicdl --version
  ```
- **安装工具**（未安装时执行）：
  ```powershell
  uv tool install musicdl
  ```
- **版本自愈（Self-Healing）**：
  - 触发条件：上游音乐平台 API 规则调整、搜索无响应或返回 403 拦截时。
  - 修复命令：
    ```powershell
    uv tool upgrade musicdl
    ```

---

## 2. 默认策略 (Defaults)

- **默认存储根目录**：`D:\素材\音乐`（保持单层或按歌手分类的清爽布局）。
- **临时下载缓存区**：`D:\素材\音乐\_musicdl_tmp`（避免客户端生成冗长的时间戳子目录污染根目录）。
- **音源优先级**：默认优先使用 `QQMusicClient,NeteaseMusicClient`；仅在优选源受限时启用 `MiguMusicClient,KuwoMusicClient` 作为后备。
- **音质策略**：优先选择无损（FLAC）或最高码率（320k MP3 / M4A），保留嵌入封面与 LRC 歌词。
- **防止覆写**：遇到同名文件默认保留，避免覆盖既有收藏。

---

## 3. 搜索与交互流程规范

`musicdl` 默认带有终端交互机制，规范如下：

1. **直接带关键词搜索**：
   - 优先使用 `-k "<歌名/歌手>"` 直接进入多源候选列表表格，跳过手动输入关键词的交互提示。
2. **候选结果核验**：
   - 在向用户展示候选或做自动决策时，重点核对**歌手名、准确曲名、时长与发行专辑**，不要单纯迷信排序第一项。
3. **格式清洗规则**：
   - 严禁将平台专有加密格式（如 `.mgg` / `.mflac`）当作最终音频；若遭遇加密流，移入 `_musicdl_tmp\unsupported_formats` 并换源重试。

---

## 4. 常用命令模板

### (1) 快速单曲多源搜索与下载
```powershell
musicdl -k "歌曲名 歌手" `
  -m "QQMusicClient,NeteaseMusicClient" `
  -i '{"work_dir": "D:\\素材\\音乐\\_musicdl_tmp"}'
```

### (2) 导入整张歌单自动拉取
```powershell
musicdl -p "https://music.163.com/#/playlist?id=XXXXXXXX" `
  -i '{"work_dir": "D:\\素材\\音乐\\_musicdl_tmp"}'
```

### (3) 指定多线程并发与全源搜索
```powershell
musicdl -k "稀缺曲目名" `
  -m "QQMusicClient,NeteaseMusicClient,KuwoMusicClient,MiguMusicClient" `
  -c '{"QQMusicClient": 4, "NeteaseMusicClient": 4}' `
  -i '{"work_dir": "D:\\素材\\音乐\\_musicdl_tmp"}'
```

---

## 5. 文件整理流 (Post-Processing)

下载完成后，将临时目录中的音频与歌词移入最终存储根目录：

```powershell
# 整理音频与歌词文件到根目录，清理空目录
Get-ChildItem -Path "D:\素材\音乐\_musicdl_tmp" -Recurse -Include *.flac, *.mp3, *.m4a, *.lrc | ForEach-Object {
  $target = Join-Path "D:\素材\音乐" $_.Name
  if (-not (Test-Path $target)) {
    Move-Item $_.FullName $target
  }
}
```

---

## 6. 联动与兜底策略 (与 leo-yt-dlp 协同)

当某首音乐因独家版权、下架或 VIP 付费限制无法在主流音乐源找到可用版本时：
- 自动触发或建议用户使用 **[`leo-yt-dlp`](file:///D:/agent-transfer/lib/skills/leo-yt-dlp)**：
  通过 B 站官方现场/MV、YouTube 高保真原声视频进行无损音频提取：
  ```powershell
  yt-dlp -f "ba/b" -x --audio-quality 0 --paths "D:\素材\音乐" "URL"
  ```
- 实现各大下载技能之间的优势互补与无缝兜底。
