"""片尾金句卡：结尾缓推镜、压暗、末帧定格，文字分两段逐字浮现。

第一段逐字淡入；停一拍后第二段淡入，同时字距慢慢拉开（"宽"字真的变宽）。
文字放在字幕区上方，压字幕前先做金句卡，这样字幕会叠在最上层。

python3 endcard.py <视频> <第一段> [第二段] <输出> [--start 秒] [--hold 秒] [--y 比例]
"""
import argparse, subprocess, sys, tempfile
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from subtitle_engine import default_font, ffprobe_for, find_ffmpeg, probe_video_size  # noqa: E402

CARD_Y = 0.76  # 文字底边离顶部 76%；字幕顶约在 81%（MarginV 35 + 字号 20，共 288）。挡脸就调小
PUSH_IN = 0.06  # 金句段推镜 6%
DARKEN = -0.16  # 金句段压暗，0.6 秒内到位


def ass_time(t: float) -> str:
    cs = round(t * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def chars(text: str, t0: int, step: int) -> str:
    return "".join(
        f"{{\\alpha&HFF&\\blur8\\t({t0 + i * step},{t0 + i * step + 420},\\alpha&H00&\\blur0)}}{ch}"
        for i, ch in enumerate(text)
    )


def card_ass(w: int, h: int, first: str, second: str, start: float, end: float, font: str,
             y_ratio: float = CARD_Y) -> str:
    font_px = round(w * 0.09)
    x, y = w // 2, round(h * y_ratio)
    line = f"{{\\an2\\move({x},{y + 16},{x},{y},0,600)\\fsp2}}" + chars(first, 0, 150)
    if second:
        line += "{\\t(900,1800,0.6,\\fsp22)}" + chars(second, 900, 170)
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Card,{font},{font_px},&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,2,0,1,{max(1, round(font_px / 32))},{max(1, round(font_px / 20))},2,20,20,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,{ass_time(start)},{ass_time(end)},Card,,0,0,0,,{line}
"""


def build_filter(start: float, hold: float, span: float, has_audio: bool, w: int, h: int) -> str:
    vf = (
        f"[0:v]tpad=stop_mode=clone:stop_duration={hold},"
        f"scale=w='trunc(iw*if(gte(t,{start}),1+{PUSH_IN}*(t-{start})/{span},1)/2)*2':h=-2:eval=frame,"
        f"crop={w}:{h},"
        f"eq=brightness='if(gte(t,{start}),{DARKEN}*min(1,(t-{start})/0.6),0)':eval=frame,"
        f"subtitles=card.ass[v]"
    )
    return vf + (f";[0:a]apad=pad_dur={hold}[a]" if has_audio else "")


def probe(ffprobe: str, video: str, entries: str, stream: str = "") -> str:
    cmd = [ffprobe, "-v", "error", *(["-select_streams", stream] if stream else []),
           "-show_entries", entries, "-of", "csv=p=0", video]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="片尾金句卡")
    p.add_argument("video")
    p.add_argument("texts", nargs="+", help="第一段 [第二段]")
    p.add_argument("out")
    p.add_argument("--start", type=float, help="金句出现时间（秒），默认片尾前 2 秒；要晚于最后一句台词")
    p.add_argument("--hold", type=float, default=0.8, help="末帧定格延长秒数")
    p.add_argument("--y", type=float, default=CARD_Y, help="文字底边位置（占画面高度的比例）")
    p.add_argument("--font", help="字体，默认按系统选择")
    a = p.parse_args(argv)
    if len(a.texts) > 2:
        p.error("最多两段文字")
    first, second = (a.texts + [""])[:2]

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print("需要带 subtitles 滤镜（libass）的 ffmpeg，见 references/subtitle-standard.md", file=sys.stderr)
        return 1
    ffprobe = ffprobe_for(ffmpeg)
    w, h = probe_video_size(Path(a.video), ffprobe) or (0, 0)
    try:
        src = float(probe(ffprobe, a.video, "format=duration"))
    except ValueError:
        print(f"读不到视频：{a.video}", file=sys.stderr)
        return 1
    start = max(0.0, src - 2.0) if a.start is None else a.start
    end = src + a.hold
    has_audio = bool(probe(ffprobe, a.video, "stream=index", "a"))

    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "card.ass").write_text(
            card_ass(w, h, first, second, start, end + 1, a.font or default_font(), a.y), encoding="utf-8")
        cmd = [ffmpeg, "-y", "-i", str(Path(a.video).resolve()),
               "-filter_complex", build_filter(start, a.hold, end - start, has_audio, w, h), "-map", "[v]",
               *(["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] if has_audio else []),
               "-t", f"{end:.3f}", "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p",
               str(Path(a.out).resolve())]
        r = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True)
    if r.returncode:
        print("\n".join(r.stderr.strip().splitlines()[-5:]), file=sys.stderr)
        return 1
    print(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
