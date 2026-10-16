---
name: leo-yt-dlp
description: 使用 yt-dlp 进行音视频高质量下载、音频提取、字幕封面保存、列表归档与故障自愈。集成 uv tool 工具链实现极速安装与自动升级，无缝联动 leo-lantern 浏览器插件提取 Cookie 绕过风控，并内置 B 站 412 API 降级与 YouTube 专项优化。当用户提出下载视频、提取音频、保存封面字幕、检测视频清晰度或修复 yt-dlp 报错时触发。
---

# Leo yt-dlp 媒体下载与提取技能

本技能负责各类网页音视频的高清抓取、音频提取、元数据保存与播放列表归档，集成现代化 `uv tool` 依赖管理以及与 `leo-lantern` 浏览器插件的鉴权闭环。

---

## 1. 环境就绪与版本自愈 (uv tool)

遵循网关开发规范（`lib/skills/README.md`），全面采用 `uv tool` 独立沙箱管理 `yt-dlp`，避免污染系统 Python：

- **版本自检**：
  ```powershell
  yt-dlp --version
  ```
- **安装工具**（未安装时执行）：
  ```powershell
  uv tool install yt-dlp
  ```
- **版本自愈（Self-Healing）**：
  - 触发条件：提示 `yt-dlp version is older than 90 days`、解析页面抛出 `Unable to extract ...`、出现签名解密（`n-sig`）或接口格式变更时。
  - 修复命令：
    ```powershell
    uv tool upgrade yt-dlp
    ```

---

## 2. 默认策略 (Defaults)

- **默认存储根目录**：Windows 下优先使用 `D:\素材\B站`；或按用户具体任务指定的存放路径。
- **画质策略**：默认选择最高可用画质（`bv*+ba/b`），音频提取默认最佳品质（`-x --audio-quality 0`）。
- **流程规范**：遵循**先探测、后规划、再执行**原则（除非用户明确说明“直接下载”）。
- **文件保护**：默认开启断点续传（`--continue`）与防止覆写（`--no-overwrites`）。
- **资产沉淀**：默认嵌入元数据（`--embed-metadata`）并保留封面（`--write-thumbnail`）及 `.info.json`。
- **安全红线**：严禁在终端输出或对话中打印 Cookie 的敏感值（如 `SESSDATA` 等）。

---

## 3. Cookie 与登录态联动 (Leo Lantern 闭环)

下载需要高分辨率（1080P/4K）、会员权限或涉及反爬风控（如 B 站 412、YouTube 登录保护）的资源时，优先使用本地 Netscape Cookie 文件：

1. **优先读取既有 Cookie**：
   - B 站优先读取：`D:\素材\B站\www.bilibili.com_cookies.txt`
   - YouTube 优先读取：`D:\media-downloader\_cookies\youtube-cookies.txt`
2. **自动导出联动（当 Cookie 缺失、过期或触发风控时）**：
   通过项目内 `leo-lantern` CLI 直接向 Chrome 插件请求导出最新 Cookie，无需人工繁琐导出：
   ```powershell
   # 导出 B站 Cookie（无感落盘为 Netscape 格式）
   node D:\agent-transfer\lib\skills\leo-lantern\scripts\cli\index.mjs cookies --domain bilibili.com --format txt --out "D:\素材\B站\www.bilibili.com_cookies.txt"

   # 导出 YouTube Cookie
   node D:\agent-transfer\lib\skills\leo-lantern\scripts\cli\index.mjs cookies --domain youtube.com --format txt --out "D:\media-downloader\_cookies\youtube-cookies.txt"
   ```

---

## 4. 探测与规划流程 (Inspect First)

拿到目标 URL 后，先执行轻量探测：

```powershell
# 探测可用清晰度与音视频流格式
yt-dlp --cookies "D:\素材\B站\www.bilibili.com_cookies.txt" --list-formats "URL"

# 或仅抓取元数据信息
yt-dlp --cookies "D:\素材\B站\www.bilibili.com_cookies.txt" --dump-json "URL"
```

在正式下载前向用户清晰列出计划：
- 视频标题与作者
- 拟选择的画质/音质规格（如 `1080P 60fps AVC + 320k AAC`）
- 保存的目标文件路径
- 是否包含封面/字幕/分P

---

## 5. 常用命令模板

### (1) 最高画质视频下载并合并
```powershell
yt-dlp -f "bv*+ba/b" --merge-output-format mp4 `
  --continue --no-overwrites `
  --write-info-json --write-thumbnail --embed-metadata `
  --cookies "D:\素材\B站\www.bilibili.com_cookies.txt" `
  -o "D:\素材\B站\%(title)s.%(ext)s" "URL"
```

### (2) 最佳品质音频提取 (无损转码)
```powershell
yt-dlp -f "ba/b" -x --audio-quality 0 `
  --continue --no-overwrites `
  --write-thumbnail --embed-metadata `
  --cookies "D:\素材\B站\www.bilibili.com_cookies.txt" `
  -o "D:\素材\B站\%(title)s.%(ext)s" "URL"
```

### (3) 字幕抓取与转换为 SRT
```powershell
yt-dlp --write-subs --write-auto-subs --sub-langs "zh-Hans,zh-Hant,en,all,-live_chat" `
  --convert-subs srt --skip-download `
  --paths "D:\素材\B站" "URL"
```

---

## 6. Bilibili 专项方案与 HTTP 412 API 降级

若遇到 B 站 HTTP 412 拦截或 `yt-dlp` 提取器暂时失效：

1. **第一阶段：自愈与 Cookie 刷新**
   - 升级工具：`uv tool upgrade yt-dlp`
   - 刷新 Cookie：执行 `leo-lantern cookies --domain bilibili.com --format txt ...` 并重试。
2. **第二阶段：API 底层降级通道**
   若 `yt-dlp` 依然无法通过，直接调用 B 站 Web API 获取 DASH 分离流：
   ```powershell
   $bvid = "BV1XXXXXXXX"
   $view = Invoke-RestMethod "https://api.bilibili.com/x/web-interface/view?bvid=$bvid"
   $cid = $view.data.cid
   $title = $view.data.title
   $play = Invoke-RestMethod "https://api.bilibili.com/x/player/playurl?bvid=$bvid&cid=$cid&qn=80&fnval=4048&fourk=1"
   
   # 获取最高码率音频流
   $audioUrl = ($play.data.dash.audio | Sort-Object bandwidth -Descending | Select-Object -First 1).baseUrl
   $out = "D:\素材\B站\$title.m4s"
   
   # 必须使用原生 curl.exe 携带合法 Referer 与 UA
   curl.exe -L $audioUrl -H "Referer: https://www.bilibili.com/video/$bvid/" -H "User-Agent: Mozilla/5.0" --output $out
   
   # 用 ffmpeg 封装转码为 mp3
   ffmpeg -y -i $out -codec:a libmp3lame -b:a 192k "D:\素材\B站\$title.mp3"
   ```

---

## 7. YouTube 专项排错指南

- **分流配对**：YouTube 1080P/4K/8K 均为视音频分流，若默认合并受阻，通过 `--list-formats` 明确指定组合（如 `-f "137+140/bestvideo+bestaudio"`）。
- **JS Challenge / n-sig 警告**：若出现 JS 提取警告，确保系统安装 Node.js 并显式传递 JS 引擎路径：
  `--js-runtimes node:node`
- **Cookie 锁处理**：避免使用 `--cookies-from-browser` 导致锁定，一律通过 `leo-lantern` 导出 Netscape 格式文件并通过 `--cookies` 读取。
