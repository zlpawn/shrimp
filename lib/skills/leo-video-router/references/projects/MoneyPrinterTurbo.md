# MoneyPrinterTurbo

仓库：https://github.com/harry0703/MoneyPrinterTurbo

## 适合

- 主题或文案 → 旁白 + 素材混剪 + 字幕 + BGM 的竖屏信息流短视频。
- `--video-count` 一次出多条（`cli.py` 另有 `--batch-file`，但不能经 helper 传，见「音频」）。
- 可一键发布 TikTok / Instagram / YouTube Shorts。

## 不适合

- 要镜头设计、风格控制、精品画面：画面靠关键词匹配素材，和文案对应松。

## 安装

- `npx skills add harry0703/MoneyPrinterTurbo -g -y`
- 安装后的 skill 目录名 `moneyprinterturbo-video`，只含 `SKILL.md` 和 `mpt_agent.py`。
- 项目源码由 helper 首次运行时下载，默认 `~/MoneyPrinterTurbo`。

## 交接

- 先运行 `python3 <本 skill 目录>/scripts/registry.py locate MoneyPrinterTurbo`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`），从输出取目录，不要自己拼路径。
- `--root` 规则（按顺序，取第一个成立的）：
  - `locate` 返回的 `path` 下有 `cli.py`（用户登记的是源码仓库）→ `--root <path>`。
  - `~/MoneyPrinterTurbo/cli.py` 存在（helper 默认目录，用户以前单独用过，里面有用户的 `config.toml` 和 Key）→ `--root ~/MoneyPrinterTurbo`。
  - 否则 → `--root ~/.shrimp/skills/MoneyPrinterTurbo`。
  - helper 发现 `--root` 下已有 `cli.py` 和 `config.example.toml` 会直接复用、不重新下载（已读 `mpt_agent.py` 的 `ensure_project` 核实）。
- 按该 skill 的 SKILL.md 执行，工作目录为 `locate` 返回的 `entry_dir`，超时至少 20 分钟：

  ```bash
  uv run --no-project --python 3.11 python mpt_agent.py --subject "<主题>" --root <见上>
  ```

- 额外 CLI 参数放在 `--` 之后；默认中文、9:16、Pexels、Edge TTS。
- 输出被截断、看不到 `MPT_RESULT` 时读 `<root>/.agent-logs/moneyprinterturbo-video/latest-result.json`；它的 SKILL.md 写死 `~/MoneyPrinterTurbo/...`，`--root` 不同时以 `<root>` 为准。

## 音频

- 内生，默认 Edge TTS。
- 先让用户二选一：
  - **omnivoice 配音**（推荐，音质更好）：agent 写文案，omnivoice 生成配音；
  - **MPT 自带 Edge TTS**：快，不需要 whisper。
- 选 omnivoice 前先说明代价：自定义音频会跳过 TTS，要从这段音频出字幕，须在 `<root>/config.toml` 的 `[app]` 段设 `subtitle_provider = "whisper"`（默认 `"edge"`）。这会让 MPT 下载并运行 whisper `large-v3`（`config.example.toml` 的 `[whisper]` 段，数 GB，默认 CPU），且设置会保留到以后每次 MPT 运行；改用户 config.toml 前先告知，用完问用户要不要改回 `"edge"`。
- 首次运行（`<root>` 还不存在）：不要先建 `<root>/config.toml`，否则 helper 会报「exists but is not a valid project」拒绝运行（`mpt_agent.py` 的 `ensure_project`）。经用户同意（这是一次安装）后先 `git clone https://github.com/harry0703/MoneyPrinterTurbo.git <root>`（helper 之后会复用它），`config.toml` 不存在就从 `config.example.toml` 复制一份，再改 `subtitle_provider`。
- 交接：`-- --video-script "<文案>" --custom-audio-file <wav 绝对路径>`。`--custom-audio-file` 必须写绝对路径：helper 以 `<root>` 为工作目录运行 `cli.py`，相对路径按 `<root>` 解析，不是 `entry_dir`。
- N 条不同的视频要 N 份文案和 N 段配音，每条单独跑一次 helper。`--video-count N` 配一个 `--custom-audio-file` 只会让 N 条视频共用同一段旁白。`cli.py` 的 `--batch-file`（JSONL 每行可带自己的 `video_script` 和 `custom_audio_file`）不能经 helper 传：helper 每次都加 `--task-id`，两者互斥。

## 注意

- 它的 skill 规定「安装和生成都不问确认」，Router 必须在交接前拿到用户对安装的同意。
- Seedance、MiniMax 等付费素材源每次需用户显式确认对应 `--confirm-*-charge`。
- 退出码 10 表示需要用户输入：缺凭证、付费确认（如 `SEEDANCE_CHARGE_CONFIRMATION_REQUIRED`）或 Key 被拒；按输出只向用户要列出的值，再重跑同一条命令。
