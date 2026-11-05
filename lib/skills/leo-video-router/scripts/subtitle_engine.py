# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "requests",
# ]
# ///

import os
import sys
import re
import json
import shutil
import argparse
import subprocess
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple


def check_voicestudio_health(base_url: str = "http://localhost:3900") -> Tuple[bool, str]:
    """
    检查 VoiceStudio 桌面端是否正在运行。
    如果未启动，坚决不私自静默降级，而是明确提示用户启动应用。
    """
    import urllib.request
    import urllib.error

    health_url = f"{base_url.rstrip('/')}/health"
    try:
        req = urllib.request.Request(health_url, headers={"User-Agent": "subtitle_engine/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                device = data.get("device", "unknown")
                version = data.get("version", "unknown")
                return True, f"VoiceStudio 运行正常 (版本: {version}, 设备: {device})"
            return False, f"VoiceStudio 状态异常: HTTP {resp.status}"
    except urllib.error.URLError:
        return False, "VoiceStudio 桌面端未运行。请先启动 VoiceStudio 桌面端应用（以使用本地语音转写与字幕功能），然后再执行字幕生成。"
    except Exception as e:
        return False, f"连接 VoiceStudio 失败: {str(e)}。请确保 VoiceStudio 已在后台运行。"


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
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0 and output_wav.exists()


def transcribe_via_voicestudio(
    wav_path: Path,
    base_url: str = "http://localhost:3900",
    language: str = "zh"
) -> Dict[str, Any]:
    """
    调用 VoiceStudio OpenAI 兼容接口 /v1/audio/transcriptions 进行语音转写。
    返回 verbose_json 格式（包含每个 segment 的 start, end, text）。
    """
    import urllib.request
    import mimetypes

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
        with urllib.request.urlopen(req, timeout=120) as resp:
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


def reflow_segments_single_line(
    segments: List[Dict[str, Any]],
    max_chars_per_line: int = 16,
    min_duration: float = 0.8
) -> List[Dict[str, Any]]:
    """
    【台词单行独立重排核心算法】：
    1. 严禁多行文本堆叠换行（\\n）；
    2. 优先按天然呼吸气口标点（，。！？、；：）拆分成独立单行；
    3. 若无标点但字数超过 max_chars_per_line，按字符数均匀切分并根据字数比例分配时间轴；
    4. 保证每行字幕时长不低于 min_duration 秒，防止眨眼即逝；
    5. 清理所有首尾无用标点与杂音符号。
    """
    reflowed = []
    
    for seg in segments:
        raw_text = seg.get("text", "").strip()
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", 0.0))
        dur = max(end - start, 0.1)

        if not raw_text:
            continue

        # 先按标点切分成子句
        # 保留标点信息以便合理断句
        clauses = re.split(r"([，。！？；：!?,;]+)", raw_text)
        merged_clauses = []
        i = 0
        while i < len(clauses):
            c = clauses[i].strip()
            if not c:
                i += 1
                continue
            punct = clauses[i + 1].strip() if i + 1 < len(clauses) else ""
            full_clause = c + punct
            merged_clauses.append(full_clause)
            i += 2

        if not merged_clauses:
            merged_clauses = [raw_text]

        # 若子句仍然超过最大字数，进一步按字数拆分
        final_pieces = []
        for c in merged_clauses:
            c_clean = c.strip()
            if not c_clean:
                continue
            if len(c_clean) <= max_chars_per_line:
                final_pieces.append(c_clean)
            else:
                # 超过字数，按 max_chars_per_line 均分
                for k in range(0, len(c_clean), max_chars_per_line):
                    piece = c_clean[k:k + max_chars_per_line].strip()
                    if piece:
                        final_pieces.append(piece)

        if not final_pieces:
            continue

        # 按各片段字符数等比例分配时间轴
        total_chars = sum(max(len(p), 1) for p in final_pieces)
        cur_start = start
        for p in final_pieces:
            p_len = max(len(p), 1)
            p_dur = dur * (p_len / total_chars)
            # 保证最低阅读时长，但不可超出原段落总时长太多
            p_end = cur_start + p_dur
            
            # 清除前后多余空格与换行，确保绝对单行
            clean_line = p.replace("\n", "").replace("\r", "").strip()
            
            reflowed.append({
                "start": cur_start,
                "end": max(p_end, cur_start + min_duration),
                "text": clean_line
            })
            cur_start = p_end

    # 时间轴后处理：消除相邻条目重叠
    for i in range(len(reflowed) - 1):
        if reflowed[i]["end"] > reflowed[i + 1]["start"]:
            reflowed[i]["end"] = reflowed[i + 1]["start"]

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


def burn_subtitles_to_video(
    video_path: Path,
    srt_path: Path,
    output_video: Path,
    font_name: str = "Microsoft YaHei",
    font_size: int = 20,
    margin_v: int = 35
) -> bool:
    """
    使用 FFmpeg 压制院线级暗影描边单行字幕至视频中。
    Windows 特别处理：通过切换工作目录避免盘符冒号路径解析 Bug。
    """
    output_video.parent.mkdir(parents=True, exist_ok=True)
    cwd = srt_path.parent
    rel_srt = srt_path.name
    
    style = (
        f"Fontname={font_name},"
        f"FontSize={font_size},"
        f"PrimaryColour=&H00FFFFFF,"
        f"OutlineColour=&H00000000,"
        f"BorderStyle=1,"
        f"Outline=2,"
        f"Shadow=1,"
        f"MarginV={margin_v}"
    )
    
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path.resolve()),
        "-vf", f"subtitles={rel_srt}:force_style='{style}'",
        "-c:a", "copy",
        "-c:v", "libx264",
        "-crf", "19",
        "-preset", "medium",
        str(output_video.resolve())
    ]
    
    res = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    return res.returncode == 0 and output_video.exists()


def process_video_subtitles(
    video_file: str,
    output_srt: Optional[str] = None,
    output_video: Optional[str] = None,
    burn: bool = True,
    language: str = "zh",
    max_chars: int = 16,
    base_url: str = "http://localhost:3900"
) -> Dict[str, Any]:
    """
    完整字幕处理流水线：
    1. 检查 VoiceStudio 健康状态（不健康则提示用户启动，不静默降级）；
    2. 提取音轨并调用 VoiceStudio 进行 STT 转写；
    3. 执行【台词单行独立重排算法】；
    4. 输出标准 .srt 文件；
    5. （可选）压制院线级带字幕成片。
    """
    video_path = Path(video_file).resolve()
    if not video_path.exists():
        return {"ok": False, "message": f"视频文件不存在: {video_path}"}

    # 1. 严格检查 VoiceStudio 状态
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
        tmp_wav = Path(tmp_dir) / f"{stem}_audio.wav"
        
        # 2. 提取音轨
        if not extract_audio(video_path, tmp_wav):
            return {"ok": False, "message": "FFmpeg 提取视频音轨失败，请确认视频包含有效音频流。"}

        # 3. 转写
        asr_res = transcribe_via_voicestudio(tmp_wav, base_url=base_url, language=language)
        if not asr_res.get("ok"):
            return asr_res

        raw_segments = asr_res["data"].get("segments", [])
        if not raw_segments and asr_res["data"].get("text"):
            # 单段 fallback
            raw_segments = [{"start": 0.0, "end": 10.0, "text": asr_res["data"]["text"]}]

        if not raw_segments:
            return {"ok": False, "message": "VoiceStudio 未在音频中检测到有效台词对白。"}

        # 4. 单行独立重排
        reflowed_cues = reflow_segments_single_line(raw_segments, max_chars_per_line=max_chars)
        
        # 5. 写入 SRT
        write_srt(reflowed_cues, target_srt)

    # 6. 压制视频
    burned = False
    if burn:
        burned = burn_subtitles_to_video(video_path, target_srt, target_video)
        if not burned:
            return {
                "ok": False,
                "srt_file": str(target_srt),
                "message": "SRT 字幕生成成功，但 FFmpeg 字幕压制失败。"
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


def main():
    parser = argparse.ArgumentParser(description="VoiceStudio 驱动的视频单行独立重排字幕生成与压制引擎")
    parser.add_argument("video", type=str, help="输入视频路径")
    parser.add_argument("--output-srt", type=str, default=None, help="输出 .srt 文件路径")
    parser.add_argument("--output-video", type=str, default=None, help="输出压制视频路径")
    parser.add_argument("--no-burn", action="store_true", help="仅生成 .srt 文件，不压制成片")
    parser.add_argument("--lang", type=str, default="zh", help="对白语言 (默认 zh)")
    parser.add_argument("--max-chars", type=int, default=16, help="单行最大汉字数 (默认 16)")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出结果")

    args = parser.parse_args()
    res = process_video_subtitles(
        video_file=args.video,
        output_srt=args.output_srt,
        output_video=args.output_video,
        burn=not args.no_burn,
        language=args.lang,
        max_chars=args.max_chars
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


if __name__ == "__main__":
    main()
