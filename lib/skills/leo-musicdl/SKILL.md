---
name: leo-musicdl
description: 使用 musicdl 进行多源高品质音乐搜索、单曲/专辑/歌单批量下载、歌词与封面匹配。集成 uv tool 工具链实现极速安装与自动升级，遵循 QQ音乐与网易云双优选源策略，支持临时目录隔离与格式清洗，并在版权受限时自动联动 leo-yt-dlp 兜底提取。当用户提出搜索或下载歌曲、歌单、无损音乐、伴奏或修复 musicdl 报错时触发。
---

# Leo musicdl 音乐搜索与批量下载技能

本技能负责全网多平台高品质音乐的精准搜索、歌单解析、音质甄别与批量拉取，全面采用 `uv tool` 独立沙箱管理，具备下载文件自动扁平化整理和版权受限时的联动兜底机制。

---

## 1. 环境就绪与网络红线 (Network & Tooling)

遵循项目开发规范（`lib/skills/README.md` 原则 2），采用 `uv tool` 独立沙箱管理 `musicdl`：

- **版本自检**：`musicdl --version`
- **安装工具**（未安装时执行）：`uv tool install musicdl`

> [!CRITICAL]
> **网络红线：严禁走境外代理（国内音乐源必须直连）**
> - **原因**：国内平台（酷我、QQ音乐、网易云、咪咕等）受唱片公司严格的**地域版权封锁（Geo-blocking）**与机房 WAF 限制。一旦流量走境外代理节点，会被平台直接返回 403 Forbidden、空数据或无限等待超时。
> - **执行要求**：在 macOS/Linux 终端执行时，**必须显式剥离代理环境变量**：
>   ```bash
>   env -u http_proxy -u https_proxy -u all_proxy musicdl ...
>   ```
>   在 Windows PowerShell 下执行：
>   ```powershell
>   $env:http_proxy=""; $env:https_proxy=""; $env:all_proxy=""; musicdl ...
>   ```
> - **唯一例外**：仅在各平台均无版权、联动 `leo-yt-dlp` 从 **YouTube** 提取音频兜底时，才使用境外代理。

---

## 2. 存储策略与智能记忆 (Dynamic Paths & Memory)

遵循 Shrimp 生态规范（参考 `leo-lantern` 与 `leo-xhs-router`），音乐下载与归档目录遵循「三级解析 + 记忆持久化」策略，杜绝硬编码：

- **记忆配置文件**：统一保存在 `~/.shrimp/skills/leo-musicdl/config.json`。
- **输出路径三级解析**：
  1. **用户显式指定（最高优先级）**：用户在对话或参数中指定存储目录，立即采用，并**自动回写更新**到 `~/.shrimp/skills/leo-musicdl/config.json`（或执行 `node scripts/config.mjs --set-dir "<path>"`），实现后续任务无感记忆，无需重复询问。
  2. **持久化记忆配置**：读取 `~/.shrimp/skills/leo-musicdl/config.json` 中的 `output_dir`（当前已持久化配置为 `/Users/user/素材/music`）。
  3. **默认兜底目录**：若未配置且未指定，回退到当前工程的 `./downloads/music`。
- **BGM 素材库自主分类 (服务于 leo-video-router 与 leo-xhs-router)**：
  下载的音频作为背景音乐（BGM）素材服务于下游视频剪辑与小红书创作。**不预设僵化死板的目录架构，完全由大模型根据音乐风格、有无人声、情绪氛围以及创作任务需求，动态自主决断分类并创建相应子目录进行归档**。
  - **歌单拆分归档**：通过 `-p` 导入的歌单曲目，同样一律拆解，由大模型逐一决断归档。
- **临时下载缓存区**：统一为 `<output_dir>/_musicdl_tmp`（避免底层客户端自动生成冗长的时间戳子目录污染素材库）。
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
   - 严禁将平台专有加密格式（如 `.mgg` / `.mflac`）当作最终音频；若遭遇加密流，移入 `_musicdl_tmp/unsupported_formats` 并换源重试。

---

## 4. 常用命令模板（注意必须剥离代理）

### (1) 快速单曲多源搜索与下载 (Bash / Zsh)
```bash
env -u http_proxy -u https_proxy -u all_proxy musicdl -k "歌曲名 歌手" \
  -m "KuwoMusicClient,QQMusicClient,NeteaseMusicClient" \
  -i '{"work_dir": "<output_dir>/_musicdl_tmp"}'
```

### (2) 导入整张歌单自动拉取
```bash
env -u http_proxy -u https_proxy -u all_proxy musicdl -p "https://music.163.com/#/playlist?id=XXXXXXXX" \
  -i '{"work_dir": "<output_dir>/_musicdl_tmp"}'
```

### (3) 非交互式 / 脚本化极速下载 (Python 优先，防止 TTY 键盘等待)
由于 `musicdl -k` 默认带有控制台交互挑选表格，在 Agent 自动化调用时，优先采用 Python 脚本无感抓取：
```bash
env -u http_proxy -u https_proxy -u all_proxy /Users/user/.local/share/uv/tools/musicdl/bin/python -c '
from musicdl.modules.sources import kuwo, qq, netease
# 实例化音源 (优先酷我/QQ/网易)
client = kuwo.KuwoMusicClient(work_dir="<output_dir>/_musicdl_tmp")
results = client.search("歌曲名")
if results:
    client.download(song_infos=[results[0]])
'
```

---

## 5. 文件整理与智能归档流 (Post-Processing & Sorting)

下载完成后，Agent 遍历临时缓存区 `<output_dir>/_musicdl_tmp` 中的音频与歌词文件：

1. **大模型自主决断与动态归档**：
   - 提取歌曲名称、歌手及版本信息，大模型运用常识与曲风理解，自主决断分类并创建合适的目标子目录进行归类（如声学属性、情绪氛围或场景题材等）。
2. **同名归档与清理**：
   - 将音频及同名歌词（`.lrc`）移入对应目标目录，确保同名配套。
   - 清理 `_musicdl_tmp` 中的中间过程文件与空文件夹。

---

## 6. 联动与兜底策略 (与 leo-yt-dlp 协同)

当某首音乐因独家版权、下架或 VIP 付费限制无法在主流音乐源找到可用版本时：
- 自动触发或建议用户使用 **`leo-yt-dlp`**：
  通过 B 站官方现场/MV、YouTube 高保真原声视频进行无损音频提取：
  ```powershell
  yt-dlp -f "ba/b" -x --audio-quality 0 --paths "./downloads/music" "URL"
  ```
- 实现各大下载技能之间的优势互补与无缝兜底。
