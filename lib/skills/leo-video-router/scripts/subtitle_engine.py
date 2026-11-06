# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///

import sys
import re
import json
import math
import time
import wave
import shutil
import argparse
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple


DEFAULT_BASE_URL = "http://127.0.0.1:3900"
HEALTH_WAIT_SECONDS = 90  # VoiceStudio 启动后约 60 秒 3900 才响应
HEALTH_RETRY_DELAY = 5
CJK_RANGES = "⺀-힯豈-﫿＀-￯"
GLYPH_WIDTH_RATIO = 0.8  # 实测 PingFang SC 约 0.72，留余量给其他字体（未实测 Windows/Linux 字体）
START_HINT = "VoiceStudio 桌面端未运行。请先启动 VoiceStudio 桌面端应用（以使用本地语音转写与字幕功能），然后再执行字幕生成。"


def check_voicestudio_health(
    base_url: str = DEFAULT_BASE_URL,
    wait_seconds: float = HEALTH_WAIT_SECONDS
) -> Tuple[bool, str]:
    """
    检查 VoiceStudio 桌面端是否正在运行，连接失败时重试到 wait_seconds。
    如果仍未启动，坚决不私自静默降级，而是明确提示用户启动应用。
    """
    health_url = f"{base_url.rstrip('/')}/health"
    req = urllib.request.Request(health_url, headers={"User-Agent": "subtitle_engine/1.0"})
    waited = 0.0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                device = data.get("device", "unknown")
                version = data.get("version", "unknown")
                return True, f"VoiceStudio 运行正常 (版本: {version}, 设备: {device})"
        except urllib.error.HTTPError as e:  # 服务在线但返回错误，重试和提示启动都没有意义
            return False, f"VoiceStudio 状态异常: HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError):
            if waited >= wait_seconds:
                return False, START_HINT
        except Exception as e:
            return False, f"连接 VoiceStudio 失败: {str(e)}。请确保 VoiceStudio 已在后台运行。"
        time.sleep(HEALTH_RETRY_DELAY)
        waited += HEALTH_RETRY_DELAY


def has_subtitles_filter() -> bool:
    """压制依赖 ffmpeg 的 subtitles 滤镜（libass），部分发行版默认不带。"""
    try:
        res = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True)
    except OSError:
        return False
    return re.search(r"^\s*\S*\s+subtitles\s", res.stdout, re.M) is not None


def extract_audio(video_path: Path, output_wav: Path) -> bool:
    """使用 FFmpeg 从视频中提取 16kHz 单声道 WAV 音轨"""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(output_wav)
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
    except OSError:
        return False
    return res.returncode == 0 and output_wav.exists()


def wav_duration(wav_path: Path) -> float:
    with wave.open(str(wav_path), "rb") as w:
        return w.getnframes() / w.getframerate()


def transcribe_via_voicestudio(
    wav_path: Path,
    base_url: str = DEFAULT_BASE_URL,
    language: str = "zh",
    timeout: float = 300
) -> Dict[str, Any]:
    """
    调用 VoiceStudio OpenAI 兼容接口 /v1/audio/transcriptions 进行语音转写。
    返回 verbose_json 格式（包含每个 segment 的 start, end, text）。
    """
    transcribe_url = f"{base_url.rstrip('/')}/v1/audio/transcriptions"
    boundary = "----VoiceStudioSubtitleFormBoundary7MA4YWxkTrZu0gW"

    # 构造 multipart/form-data
    body = bytearray()

    # file 参数
    filename = wav_path.name
    mime_type = "audio/wav"
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("utf-8"))
    body.extend(f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"))
    with open(wav_path, "rb") as f:
        body.extend(f.read())
    body.extend(b"\r\n")

    # model 参数
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="model"\r\n\r\n')
    body.extend(b"whisper-1\r\n")

    # response_format 参数
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="response_format"\r\n\r\n')
    body.extend(b"verbose_json\r\n")

    # language 参数
    if language:
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(b'Content-Disposition: form-data; name="language"\r\n\r\n')
        body.extend(f"{language}\r\n".encode("utf-8"))

    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(
        transcribe_url,
        data=bytes(body),
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "subtitle_engine/1.0"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {"ok": True, "data": data}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_body)
            detail = err_json.get("detail", {})
            msg = detail.get("message") if isinstance(detail, dict) else str(detail)
        except Exception:
            msg = err_body
        return {
            "ok": False,
            "error_type": f"HTTP_{e.code}",
            "message": f"VoiceStudio 转写接口返回错误 (HTTP {e.code}): {msg}"
        }
    except Exception as e:
        return {
            "ok": False,
            "error_type": "REQUEST_ERROR",
            "message": f"调用 VoiceStudio 转写失败: {str(e)}"
        }


def segments_from_transcript(data: Dict[str, Any], duration: float) -> List[Dict[str, Any]]:
    """取转写分段；接口只返回全文时，整段时间轴用音频真实时长。"""
    segments = data.get("segments") or []
    if not segments and data.get("text"):
        segments = [{"start": 0.0, "end": duration, "text": data["text"]}]
    return segments


def text_width(text: str) -> float:
    """显示宽度：汉字等全角字符记 1，拉丁字母等半角字符记 0.5。"""
    return sum(1 if re.match(f"[{CJK_RANGES}]", c) else 0.5 for c in text)


def split_clauses(text: str) -> List[str]:
    """按标点切成子句。半角标点后须跟空白才算断句，避免切开 1,000 这样的数字。"""
    clauses = []
    for part in re.split(r"(?<=[，。！？；：])|(?<=[!?,;])(?=\s)", text):
        clause = part.lstrip(" ，。！？；：、!?,;:.").rstrip(" ，。；：、,;:.")
        if clause:
            clauses.append(clause)
    return clauses


def wrap_clause(clause: str, max_width: float) -> List[str]:
    """子句超宽时等宽细分：汉字逐字可断，拉丁单词整词换行（超长单词才硬切）。"""
    total = text_width(clause)
    if total <= max_width:
        return [clause]

    tokens = []
    for tok in re.findall(rf"[{CJK_RANGES}]|[^\s{CJK_RANGES}]+\s*", clause):
        while text_width(tok.strip()) > max_width:
            cut = int(max_width * 2)
            tokens.append(tok[:cut])
            tok = tok[cut:]
        tokens.append(tok)

    target = total / math.ceil(total / max_width)
    lines = [""]
    for tok in tokens:
        cur = text_width(lines[-1])
        if lines[-1] and (cur >= target or cur + text_width(tok.strip()) > max_width):
            lines.append("")
        lines[-1] += tok
    return [s.strip() for s in lines if s.strip()]


def reflow_segments_single_line(
    segments: List[Dict[str, Any]],
    max_chars_per_line: int = 16,
    min_duration: float = 0.8
) -> List[Dict[str, Any]]:
    """
    【台词单行独立重排核心算法】：
    1. 严禁多行文本堆叠换行（\\n）；
    2. 优先按天然呼吸气口标点（，。！？；：）拆分成独立单行；
    3. 若子句超过 max_chars_per_line，按显示宽度均匀细分并根据宽度比例分配时间轴；
    4. 保证每行字幕时长不低于 min_duration 秒，防止眨眼即逝；
    5. 清理首尾无用标点（保留句末 ！？ 的语气）。
    """
    reflowed = []

    for seg in segments:
        raw_text = re.sub(r"[\r\n]+", " ", seg.get("text", "")).strip()
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", 0.0))
        dur = max(end - start, 0.1)

        pieces = [line for clause in split_clauses(raw_text) for line in wrap_clause(clause, max_chars_per_line)]
        if not pieces:
            continue

        # 按各片段显示宽度等比例分配时间轴
        total = sum(text_width(p) for p in pieces)
        cur_start = start
        for p in pieces:
            p_end = cur_start + dur * (text_width(p) / total)
            reflowed.append({"start": cur_start, "end": p_end, "text": p})
            cur_start = p_end

    # 时间轴后处理：保证最短展示且相邻不重叠
    # ponytail: 语速持续过快时字幕会累积滞后，到下一个停顿才追平；要严格同步需合并短句
    for i, cue in enumerate(reflowed):
        if i and cue["start"] < reflowed[i - 1]["end"]:
            cue["start"] = reflowed[i - 1]["end"]
        cue["end"] = max(cue["end"], cue["start"] + min_duration)
    return reflowed


def format_srt_timestamp(seconds: float) -> str:
    """将秒数转为 SRT 规范时间戳 00:00:00,000"""
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        seconds += 1
        millis -= 1000
    sec = int(seconds)
    mins = sec // 60
    secs = sec % 60
    hrs = mins // 60
    mins = mins % 60
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def write_srt(cues: List[Dict[str, Any]], srt_path: Path) -> Path:
    """写入标准 SRT 字幕文件"""
    srt_path.parent.mkdir(parents=True, exist_ok=True)
    with open(srt_path, "w", encoding="utf-8") as f:
        for idx, cue in enumerate(cues, 1):
            st = format_srt_timestamp(cue["start"])
            et = format_srt_timestamp(cue["end"])
            txt = cue["text"].strip()
            f.write(f"{idx}\n{st} --> {et}\n{txt}\n\n")
    return srt_path


def default_font(platform: str = sys.platform) -> str:
    if platform == "darwin":
        return "PingFang SC"
    if platform == "win32":
        return "Microsoft YaHei"
    return "Noto Sans CJK SC"


def probe_video_size(video_path: Path) -> Optional[Tuple[int, int]]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x",
        str(video_path)
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        width, height = res.stdout.strip().split("x")
        return int(width), int(height)
    except (OSError, ValueError):
        return None


def subtitle_style(
    width: int,
    height: int,
    font_name: str,
    max_chars: int = 16,
    margin_v: int = 35
) -> str:
    """
    院线级样式。SRT 经 ffmpeg 转 ASS 后 PlayResY=288，字号按画面高度缩放，
    竖屏上字号 20 会撑破单行，所以按“满行不超过画面宽 90%”收窄，描边和投影同比缩放。
    GLYPH_WIDTH_RATIO 是校准系数：libass 字号含行高，字宽小于字号。
    """
    font_size = min(20, width * 0.9 / max_chars / GLYPH_WIDTH_RATIO / (height / 288))
    ratio = font_size / 20
    return (
        f"Fontname={font_name},"
        f"FontSize={font_size:g},"
        f"PrimaryColour=&H00FFFFFF,"
        f"OutlineColour=&H00000000,"
        f"BorderStyle=1,"
        f"Outline={2 * ratio:.2f},"
        f"Shadow={ratio:.2f},"
        f"MarginV={margin_v}"
    )


def burn_subtitles_to_video(
    video_path: Path,
    srt_path: Path,
    output_video: Path,
    font_name: Optional[str] = None,
    max_chars: int = 16
) -> Tuple[bool, str]:
    """
    使用 FFmpeg 压制院线级暗影描边单行字幕至视频中，返回 (是否成功, 错误信息)。
    字幕复制到临时目录并用固定文件名，文件名里的引号、逗号、方括号和 Windows 盘符
    都不会进入滤镜语法。
    """
    output_video.parent.mkdir(parents=True, exist_ok=True)
    width, height = probe_video_size(video_path) or (1920, 1080)
    style = subtitle_style(width, height, font_name or default_font(), max_chars)

    with tempfile.TemporaryDirectory() as tmp_dir:
        shutil.copyfile(srt_path, Path(tmp_dir) / "subtitles.srt")
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path.resolve()),
            "-vf", f"subtitles=subtitles.srt:force_style='{style}'",
            "-c:a", "copy",
            "-c:v", "libx264",
            "-crf", "19",
            "-preset", "medium",
            str(output_video.resolve())
        ]
        res = subprocess.run(cmd, cwd=tmp_dir, capture_output=True, text=True)

    if res.returncode == 0 and output_video.exists():
        return True, ""
    return False, "\n".join(res.stderr.strip().splitlines()[-5:])


def process_video_subtitles(
    video_file: str,
    output_srt: Optional[str] = None,
    output_video: Optional[str] = None,
    burn: bool = True,
    language: str = "zh",
    max_chars: int = 16,
    base_url: str = DEFAULT_BASE_URL,
    font_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    完整字幕处理流水线：
    1. 需要压制时先确认 ffmpeg 带 subtitles 滤镜，避免转写完才失败；
    2. 检查 VoiceStudio 健康状态（不健康则提示用户启动，不静默降级）；
    3. 提取音轨并调用 VoiceStudio 进行 STT 转写；
    4. 执行【台词单行独立重排算法】；
    5. 输出标准 .srt 文件；
    6. （可选）压制院线级带字幕成片。
    """
    video_path = Path(video_file).resolve()
    if not video_path.exists():
        return {"ok": False, "message": f"视频文件不存在: {video_path}"}

    if burn and not has_subtitles_filter():
        return {
            "ok": False,
            "error_type": "FFMPEG_NO_SUBTITLES_FILTER",
            "message": "当前 ffmpeg 缺少 subtitles 滤镜（未启用 libass）或未安装，无法压制字幕。"
                       "安装方法见 references/subtitle-standard.md；只要 .srt 可加 --no-burn。"
        }

    # 严格检查 VoiceStudio 状态
    ok, msg = check_voicestudio_health(base_url)
    if not ok:
        return {
            "ok": False,
            "error_type": "VOICESTUDIO_NOT_RUNNING",
            "message": msg
        }

    # 准备临时目录与路径
    out_dir = video_path.parent
    stem = video_path.stem

    # 智能定位【成片/发布版】输出目录
    publish_dir = None
    if video_path.parent.name == "原始版" and video_path.parent.parent.name == "成片":
        candidate = video_path.parent.parent / "发布版"
        if candidate.exists():
            publish_dir = candidate
    elif video_path.parent.name == "成片" and (video_path.parent / "发布版").exists():
        publish_dir = video_path.parent / "发布版"
    elif (video_path.parent / "成片" / "发布版").exists():
        publish_dir = video_path.parent / "成片" / "发布版"

    target_dir = publish_dir if publish_dir else out_dir
    target_srt = Path(output_srt).resolve() if output_srt else target_dir / f"{stem}.srt"
    target_video = Path(output_video).resolve() if output_video else target_dir / f"{stem}_with_subtitles.mp4"

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_wav = Path(tmp_dir) / "audio.wav"

        # 提取音轨
        if not extract_audio(video_path, tmp_wav):
            return {"ok": False, "message": "FFmpeg 提取视频音轨失败，请确认已安装 ffmpeg 且视频包含有效音频流。"}
        duration = wav_duration(tmp_wav)

        # 转写。ponytail: 超时按时长 3 倍估算，未实测长视频，不够再调系数
        asr_res = transcribe_via_voicestudio(
            tmp_wav, base_url=base_url, language=language, timeout=max(300, duration * 3)
        )
        if not asr_res.get("ok"):
            return asr_res

        raw_segments = segments_from_transcript(asr_res["data"], duration)
        if not raw_segments:
            return {"ok": False, "message": "VoiceStudio 未在音频中检测到有效台词对白。"}

        # 单行独立重排
        reflowed_cues = reflow_segments_single_line(raw_segments, max_chars_per_line=max_chars)

        # 写入 SRT
        write_srt(reflowed_cues, target_srt)

    # 压制视频
    burned = False
    if burn:
        burned, burn_error = burn_subtitles_to_video(
            video_path, target_srt, target_video, font_name=font_name, max_chars=max_chars
        )
        if not burned:
            return {
                "ok": False,
                "srt_file": str(target_srt),
                "error_type": "FFMPEG_BURN_FAILED",
                "message": f"SRT 字幕生成成功，但 FFmpeg 字幕压制失败：\n{burn_error}"
            }

    result = {
        "ok": True,
        "message": "字幕提取与单行重排完成！" + (" 成片压制成功。" if burned else ""),
        "srt_file": str(target_srt).replace("\\", "/"),
        "cue_count": len(reflowed_cues)
    }
    if burned:
        result["subtitled_video"] = str(target_video).replace("\\", "/")

    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="VoiceStudio 驱动的视频单行独立重排字幕生成与压制引擎")
    parser.add_argument("video", type=str, help="输入视频路径")
    parser.add_argument("--output-srt", type=str, default=None, help="输出 .srt 文件路径")
    parser.add_argument("--output-video", type=str, default=None, help="输出压制视频路径")
    parser.add_argument("--burn", action=argparse.BooleanOptionalAction, default=True,
                        help="压制字幕进成片（默认开启）；--no-burn 仅生成 .srt")
    parser.add_argument("--lang", type=str, default="zh", help="对白语言 (默认 zh)")
    parser.add_argument("--max-chars", type=int, default=16, help="单行最大汉字数，半角字符按半个计 (默认 16)")
    parser.add_argument("--font", type=str, default=None, help="字幕字体（默认按系统选择）")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出结果")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    res = process_video_subtitles(
        video_file=args.video,
        output_srt=args.output_srt,
        output_video=args.output_video,
        burn=args.burn,
        language=args.lang,
        max_chars=args.max_chars,
        font_name=args.font
    )

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        if res.get("ok"):
            print(f"[SUCCESS] {res['message']}")
            print(f"  -> 字幕文件: {res['srt_file']} (共 {res['cue_count']} 条独立单行)")
            if "subtitled_video" in res:
                print(f"  -> 压制成片: {res['subtitled_video']}")
                print(f"  -> 预览链接: [▶️ 播放带字幕成片](file:///{res['subtitled_video']})")
        else:
            print(f"[FAILED] {res.get('message', '操作失败')}")
            if res.get("error_type"):
                print(f"  错误类型: {res['error_type']}")
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
