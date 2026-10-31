# MoneyPrinterTurbo

仓库：https://github.com/harry0703/MoneyPrinterTurbo

## 适合

- 主题或文案 → 旁白 + 素材混剪 + 字幕 + BGM 的竖屏信息流短视频。
- `--video-count` 一次出多条，`--batch-file` 批量。
- 可一键发布 TikTok / Instagram / YouTube Shorts。

## 不适合

- 要镜头设计、风格控制、精品画面：画面靠关键词匹配素材，和文案对应松。

## 安装

- `npx skills add harry0703/MoneyPrinterTurbo -g -y`
- 安装后的 skill 目录名 `moneyprinterturbo-video`，只含 `SKILL.md` 和 `mpt_agent.py`。
- 项目源码由 helper 首次运行时下载，默认 `~/MoneyPrinterTurbo`。

## 交接

- 先运行 `python3 scripts/registry.py locate MoneyPrinterTurbo`（Windows 上用 `python`），从输出取目录，不要自己拼路径。
- `--root` 规则：
  - `locate` 返回的 `path` 下有 `cli.py`（用户登记的是源码仓库）→ `--root <path>`。
  - 否则 → `--root ~/.shrimp/skills/MoneyPrinterTurbo`。
  - helper 发现 `--root` 下已有 `cli.py` 和 `config.example.toml` 会直接复用、不重新下载（已读 `mpt_agent.py` 的 `ensure_project` 核实）。
- 按该 skill 的 SKILL.md 执行，工作目录为 `locate` 返回的 `entry_dir`，超时至少 20 分钟：

  ```bash
  uv run --no-project --python 3.11 python mpt_agent.py --subject "<主题>" --root <见上>
  ```

- 额外 CLI 参数放在 `--` 之后；默认中文、9:16、Pexels、Edge TTS。

## 音频

- 内生。
- 用 omnivoice 时：先定稿文案，omnivoice 生成配音，再传 `-- --video-script "<文案>" --custom-audio-file <wav>`。
- 自定义音频时字幕如何生成未验证，首次使用要检查成片字幕。

## 注意

- 它的 skill 规定「安装和生成都不问确认」，Router 必须在交接前拿到用户对安装的同意。
- Seedance、MiniMax 等付费素材源每次需用户显式确认对应 `--confirm-*-charge`。
- 只在缺 API Key 时它会退出码 10 请求凭证。
