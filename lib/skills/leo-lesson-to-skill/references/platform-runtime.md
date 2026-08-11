# Windows、macOS 与 Linux 运行规范

## 路径和 Python

1. 从当前 `SKILL.md` 解析绝对 `SKILL_ROOT`。
2. 探测 Python 3，可使用 `python3`、`python` 或 `py -3`；记录最终可执行文件。
3. 所有脚本使用绝对路径，不依赖当前目录。
4. 所有用户路径作为独立参数传递，不拼入未经转义的 shell 字符串。

Windows 使用 `-LiteralPath` 或 .NET API；macOS/Linux 使用参数数组或完整引用参数。Manifest 使用规范化绝对路径。

## 工具探测

- 所有输入：`ffmpeg`、`ffprobe`、可用 ASR 或已有字幕。
- URL：额外要求 `yt-dlp`。
- Windows：CUDA 短片段测试成功后才使用 CUDA。
- Apple Silicon：可优先验证 `mlx_whisper`。
- Linux：CUDA 测试成功后使用 CUDA，否则 CPU。

工具命令存在不代表后端可用，ASR 必须用短片段验证。

## 临时目录

使用 `init-run` 创建系统临时目录下的唯一运行目录，不复用旧目录。Windows、macOS 和 Linux 都必须拒绝 Symlink、Junction 或 Reparse Point 清理目标。

## FFmpeg

滤镜作为独立参数传递。退出码为零后仍需检查输出数量、时间戳和媒体可读性。

## 发布

发布使用同文件系统 partial 目录和原子重命名。已有同名 Skill 默认拒绝；明确授权覆盖后先创建唯一备份。

## 环境记录

记录 OS、架构、Python、ffmpeg/ffprobe/yt-dlp、ASR 工具/模型/设备/语言、多模态能力、OCR 和 pHash 状态。
