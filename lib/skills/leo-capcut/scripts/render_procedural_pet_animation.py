import math, sys, os, struct, wave, subprocess
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 720, 960
FPS = 30
DURATION_SEC = 10
TOTAL_FRAMES = FPS * DURATION_SEC

OUTPUT_DIR = Path('D:/agent-transfer/lib/skills/leo-capcut/assets/procedural_pet')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
RAW_VIDEO_PATH = OUTPUT_DIR / 'raw_procedural_cat.mp4'
AUDIO_PATH = OUTPUT_DIR / 'procedural_cat_audio.wav'
FINAL_PREVIEW_PATH = Path('D:/agent-transfer/lib/skills/leo-capcut/procedural_cat_verified_preview.mp4')

print(f'Starting procedural animation rendering: {TOTAL_FRAMES} frames @ {FPS}fps...')

# ----------------------------------------------------
# 1. Synthesize Procedural Audio (Celesta/Music Box BGM + SFX)
# ----------------------------------------------------
def synthesize_audio():
    sample_rate = 44100
    n_samples = int(sample_rate * DURATION_SEC)
    audio = np.zeros(n_samples, dtype=np.float32)
    
    # Scale frequencies (C Major Pentatonic: C5, D5, E5, G5, A5, C6)
    notes = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50]
    
    def add_tone(freq, start_sec, dur_sec, amp=0.25):
        start_idx = int(start_sec * sample_rate)
        end_idx = min(n_samples, start_idx + int(dur_sec * sample_rate))
        length = end_idx - start_idx
        if length <= 0: return
        t = np.linspace(0, dur_sec, length, False)
        # Celesta envelope: fast attack, exponential decay
        envelope = np.exp(-t * 3.5)
        # Fundamental + gentle 2nd harmonic
        wave = np.sin(2 * np.pi * freq * t) * 0.7 + np.sin(2 * np.pi * freq * 2 * t) * 0.3
        audio[start_idx:end_idx] += wave * envelope * amp

    # Cute lullaby melody
    melody = [
        (0.0, 0), (0.4, 2), (0.8, 3), (1.4, 4),
        (2.0, 3), (2.6, 2), (3.2, 0),
        # Playful section
        (3.8, 2), (4.2, 4), (4.6, 5), (5.0, 4), (5.4, 3), (5.8, 2), (6.2, 4),
        # Healing calm section
        (6.8, 3), (7.4, 2), (8.0, 0), (8.8, 2), (9.4, 0)
    ]
    for start_t, n_idx in melody:
        add_tone(notes[n_idx], start_t, 1.2, amp=0.22)

    # Paw tap pop at t = 4.8s
    pop_start = int(4.8 * sample_rate)
    pop_len = int(0.18 * sample_rate)
    t_pop = np.linspace(0, 0.18, pop_len, False)
    pop_freq = np.linspace(600, 150, pop_len)
    pop_sound = np.sin(2 * np.pi * pop_freq * t_pop) * np.exp(-t_pop * 25.0) * 0.28
    audio[pop_start:pop_start+pop_len] += pop_sound

    # Sparkle chime at t = 7.0s (butterfly landing)
    for i, f in enumerate([1318.51, 1567.98, 1760.00, 2093.00]):
        add_tone(f, 7.0 + i * 0.1, 0.9, amp=0.15)

    # Normalize and write 16-bit WAV
    max_val = np.max(np.abs(audio))
    if max_val > 0.01:
        audio = audio / max_val * 0.88
    int_audio = (audio * 32767).astype(np.int16)
    
    with wave.open(str(AUDIO_PATH), 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int_audio.tobytes())
    print(f'Procedural audio synthesized: {AUDIO_PATH}')

synthesize_audio()

# ----------------------------------------------------
# 2. Render Procedural Visual Frames
# ----------------------------------------------------
fourcc = cv2.VideoWriter_fourcc(*'mp4v')
writer = cv2.VideoWriter(str(RAW_VIDEO_PATH), fourcc, FPS, (W, H))

scale = 2
sw, sh = W * scale, H * scale
floor_y = int(sh * 0.72)
rug_cx, rug_cy = sw // 2, floor_y + 110 * scale
cx = sw // 2
cat_base_y = floor_y + 50 * scale

for frame_idx in range(TOTAL_FRAMES):
    t = frame_idx / FPS
    
    # 1. Background
    bg = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(bg)
    for y in range(sh):
        u = y / sh
        if u < 0.72:
            v = u / 0.72
            # Sunset peach-lavender
            r = int(255 * (1-v) + 248 * v)
            g = int(248 * (1-v) + 238 * v)
            b = int(240 * (1-v) + 246 * v)
        else:
            v = (u - 0.72) / 0.28
            r = int(240 * (1-v) + 230 * v)
            g = int(222 * (1-v) + 210 * v)
            b = int(210 * (1-v) + 195 * v)
        bdraw.line([(0, y), (sw, y)], fill=(r, g, b, 255))
        
    bdraw.line([(0, floor_y), (sw, floor_y)], fill=(225, 205, 195, 255), width=3*scale)

    # Ambient floating light dust / bokeh
    bokeh = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    bk_draw = ImageDraw.Draw(bokeh)
    for i in range(20):
        bx = int((math.sin(i * 1.7 + t * 0.3) * 0.45 + 0.5) * sw)
        by = int(((i * 0.19 - t * 0.07) % 1.0) * sh)
        br = int((12 + (i % 4) * 6) * scale)
        alpha = int(35 + (i % 3) * 20)
        bk_draw.ellipse([bx - br, by - br, bx + br, by + br], fill=(255, 255, 255, alpha))
    bokeh = bokeh.filter(ImageFilter.GaussianBlur(8 * scale))
    bg = Image.alpha_composite(bg, bokeh)

    # Soft round rug
    rug_shadow = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    rs_draw = ImageDraw.Draw(rug_shadow)
    rs_draw.ellipse([rug_cx - 270*scale, rug_cy - 70*scale, rug_cx + 270*scale, rug_cy + 90*scale], fill=(160, 140, 140, 70))
    rug_shadow = rug_shadow.filter(ImageFilter.GaussianBlur(14 * scale))
    bg = Image.alpha_composite(bg, rug_shadow)
    
    rug_layer = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    rl_draw = ImageDraw.Draw(rug_layer)
    rl_draw.ellipse([rug_cx - 260*scale, rug_cy - 75*scale, rug_cx + 260*scale, rug_cy + 75*scale], fill=(255, 235, 230, 255), outline=(250, 215, 210, 255), width=4*scale)
    for deg in range(0, 360, 15):
        rad = math.radians(deg)
        rx = rug_cx + 248 * scale * math.cos(rad)
        ry = rug_cy + 70 * scale * math.sin(rad)
        rl_draw.ellipse([rx - 4*scale, ry - 4*scale, rx + 4*scale, ry + 4*scale], fill=(255, 190, 185, 255))
    bg = Image.alpha_composite(bg, rug_layer)

    # 2. Butterfly Trajectory
    # Phase 1 (0-3.5s): Fluttering above
    # Phase 2 (3.5-6.8s): Diving down towards paws
    # Phase 3 (6.8-10s): Perched on cat right ear!
    if t < 3.5:
        bf_x = sw // 2 + int((240 * math.cos(0.9 * t)) * scale)
        bf_y = int((240 + 80 * math.sin(0.8 * t)) * scale)
    elif t < 6.8:
        u_mid = (t - 3.5) / 3.3
        # Swoop down and tease
        bf_x = sw // 2 + int((130 + 100 * math.sin(2.5 * u_mid * math.pi)) * scale)
        bf_y = int((300 + 170 * math.sin(u_mid * math.pi)) * scale)
    else:
        # Landed softly on right ear!
        u_land = min(1.0, (t - 6.8) / 0.5)
        # Ear tip target
        ear_target_x = cx + 130 * scale
        ear_target_y = cat_base_y - int(480 * scale)
        bf_x = int(ear_target_x)
        bf_y = int(ear_target_y + math.sin(t * 2) * 3)

    # 3. Cat Kinematics
    breath = math.sin(2 * math.pi * 0.8 * t)
    sx = 1.0 - 0.02 * breath
    sy = 1.0 + 0.025 * breath

    cat = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(cat)

    # Tail (S-curve behind cat, curling up on right)
    tail_base_x = cx + int(110 * scale)
    tail_base_y = cat_base_y - int(30 * scale)
    tail_pts = []
    wag_speed = 2.2 if 3.5 <= t <= 6.8 else 1.0
    for i in range(20):
        u = i / 19.0
        wag = math.sin(2 * math.pi * wag_speed * t - u * 2.5) * (30 if 3.5 <= t <= 6.8 else 18)
        angle = math.radians(40 + wag - u * 150)
        dist = u * 260 * scale
        tx = tail_base_x + dist * math.cos(angle)
        ty = tail_base_y - dist * math.sin(angle)
        tail_pts.append((tx, ty))
    for i in range(len(tail_pts) - 1):
        th = int((36 - i * 1.1) * scale)
        cdraw.line([tail_pts[i], tail_pts[i+1]], fill=(255, 175, 120, 255), width=max(4, th))
    tip = tail_pts[-1]
    cdraw.ellipse([tip[0]-18*scale, tip[1]-18*scale, tip[0]+18*scale, tip[1]+18*scale], fill=(255, 255, 255, 255))

    # Cat Body
    body_cx = cx
    body_cy = cat_base_y - int(100 * scale * sy)
    b_rx = int(160 * scale * sx)
    b_ry = int(140 * scale * sy)
    cdraw.ellipse([body_cx - b_rx, body_cy - b_ry, body_cx + b_rx, body_cy + b_ry], fill=(255, 248, 240, 255))
    cdraw.ellipse([body_cx - int(b_rx*0.65), body_cy - int(b_ry*0.8), body_cx + int(b_rx*0.65), body_cy + int(b_ry*0.85)], fill=(255, 255, 255, 255))

    # Head & Tilt
    head_cy = body_cy - b_ry - int(45 * scale * sy)
    dx_bf = bf_x - cx
    dy_bf = bf_y - head_cy
    d_bf = math.hypot(dx_bf, dy_bf) + 1e-5
    
    # Ears
    # Left ear
    le_base_l = (cx - 145 * scale, head_cy - 60 * scale)
    le_base_r = (cx - 40 * scale, head_cy - 135 * scale)
    le_tip = (cx - 130 * scale + int(8*math.sin(t*3.5)), head_cy - 215 * scale)
    cdraw.polygon([le_base_l, le_tip, le_base_r], fill=(255, 180, 120, 255))
    cdraw.polygon([
        (le_base_l[0]+14*scale, le_base_l[1]-4*scale),
        (le_tip[0]+6*scale, le_tip[1]+24*scale),
        (le_base_r[0]-12*scale, le_base_r[1]-4*scale)
    ], fill=(255, 175, 185, 255))

    # Right ear
    re_base_l = (cx + 40 * scale, head_cy - 135 * scale)
    re_base_r = (cx + 145 * scale, head_cy - 60 * scale)
    re_tip = (cx + 130 * scale - int(8*math.sin(t*3.5)), head_cy - 215 * scale)
    cdraw.polygon([re_base_l, re_tip, re_base_r], fill=(255, 180, 120, 255))
    cdraw.polygon([
        (re_base_l[0]+12*scale, re_base_l[1]-4*scale),
        (re_tip[0]-6*scale, re_tip[1]+24*scale),
        (re_base_r[0]-14*scale, re_base_r[1]-4*scale)
    ], fill=(255, 175, 185, 255))

    # Head
    h_rx = int(175 * scale)
    h_ry = int(145 * scale)
    cdraw.ellipse([cx - h_rx, head_cy - h_ry, cx + h_rx, head_cy + h_ry], fill=(255, 248, 240, 255))
    cdraw.pieslice([cx - h_rx, head_cy - h_ry + 20*scale, cx - 20*scale, head_cy + 10*scale], 195, 290, fill=(255, 180, 120, 255))
    cdraw.pieslice([cx + 20*scale, head_cy - h_ry + 20*scale, cx + h_rx, head_cy + 10*scale], 250, 345, fill=(255, 180, 120, 255))

    # Cheeks blush (stronger in Phase 3)
    blush_alpha = 220 if t >= 6.8 else 145
    blush = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    bld = ImageDraw.Draw(blush)
    bld.ellipse([cx - 145*scale, head_cy + 10*scale, cx - 75*scale, head_cy + 55*scale], fill=(255, 135, 155, blush_alpha))
    bld.ellipse([cx + 75*scale, head_cy + 10*scale, cx + 145*scale, head_cy + 55*scale], fill=(255, 135, 155, blush_alpha))
    blush = blush.filter(ImageFilter.GaussianBlur(16 * scale))
    cat = Image.alpha_composite(cat, blush)
    cdraw = ImageDraw.Draw(cat)

    # Eyes
    # In Phase 3 (t >= 7.0), eyes are closed in peaceful smile ^ ^
    is_peaceful = (t >= 7.0)
    blink = 0.0
    if not is_peaceful:
        b_phase = t % 2.8
        if 2.5 <= b_phase <= 2.7:
            blink = math.sin((b_phase - 2.5) / 0.2 * math.pi)
            
    eye_x_span = 70 * scale
    eye_y = head_cy - 12 * scale
    look_dx = (dx_bf / d_bf) * 16 * scale
    look_dy = (dy_bf / d_bf) * 12 * scale
    
    for side in (-1, 1):
        ex = cx + side * eye_x_span
        if is_peaceful or blink > 0.7:
            # Happy curved wink ^ ^
            cdraw.arc([ex - 28*scale, eye_y - 14*scale, ex + 28*scale, eye_y + 18*scale], 195, 345, fill=(75, 45, 40, 255), width=6*scale)
        else:
            er_x, er_y = int(36 * scale), max(4, int(44 * scale * (1.0 - blink)))
            cdraw.ellipse([ex - er_x, eye_y - er_y, ex + er_x, eye_y + er_y], fill=(255, 255, 255, 255), outline=(75, 45, 40, 255), width=3*scale)
            # Pupil dilation in Phase 2
            ir_mult = 1.15 if 3.5 <= t <= 6.8 else 1.0
            ir_x, ir_y = int(27 * scale * ir_mult), max(3, int(34 * scale * (1.0 - blink) * ir_mult))
            ix = ex + int(look_dx)
            iy = eye_y + int(look_dy)
            cdraw.ellipse([ix - ir_x, iy - ir_y, ix + ir_x, iy + ir_y], fill=(42, 195, 180, 255))
            cdraw.ellipse([ix - int(ir_x*0.55), iy - int(ir_y*0.55), ix + int(ir_x*0.55), iy + int(ir_y*0.55)], fill=(18, 48, 55, 255))
            # Twinkle stars
            cdraw.ellipse([ix - 11*scale, iy - 13*scale, ix - 3*scale, iy - 5*scale], fill=(255, 255, 255, 255))
            cdraw.ellipse([ix + 4*scale, iy + 5*scale, ix + 9*scale, iy + 10*scale], fill=(255, 255, 255, 220))

    # Nose & :3 Mouth
    nose_y = head_cy + 25 * scale
    cdraw.polygon([(cx - 9*scale, nose_y - 3*scale), (cx + 9*scale, nose_y - 3*scale), (cx, nose_y + 7*scale)], fill=(255, 140, 160, 255))
    cdraw.arc([cx - 26*scale, nose_y + 3*scale, cx, nose_y + 24*scale], 10, 170, fill=(80, 50, 45, 255), width=4*scale)
    cdraw.arc([cx, nose_y + 3*scale, cx + 26*scale, nose_y + 24*scale], 10, 170, fill=(80, 50, 45, 255), width=4*scale)

    # Whiskers
    for side in (-1, 1):
        wx = cx + side * 50 * scale
        for wy_off, ang in [(-5*scale, -5), (5*scale, 5), (15*scale, 15)]:
            wy = nose_y + wy_off
            wlen = 65 * scale
            wrad = math.radians(ang if side > 0 else 180 - ang)
            cdraw.line([(wx, wy), (wx + wlen * math.cos(wrad), wy + wlen * math.sin(wrad))], fill=(170, 145, 145, 180), width=2*scale)

    # Front Paws
    paw_y = cat_base_y - int(15 * scale)
    cdraw.ellipse([cx - 75*scale, paw_y - 22*scale, cx - 20*scale, paw_y + 22*scale], fill=(255, 255, 255, 255), outline=(240, 225, 215, 255), width=3*scale)
    
    # Right paw lifts playfully during Phase 2 (3.5 - 6.5s)
    r_lift = 0
    if 3.5 <= t <= 6.5:
        progress = (t - 3.5) / 3.0
        r_lift = int(math.sin(progress * math.pi) * 85 * scale)
    rpx = cx + 55 * scale + int(dx_bf * 0.08)
    rpy = paw_y - r_lift
    cdraw.ellipse([rpx - 28*scale, rpy - 22*scale, rpx + 28*scale, rpy + 22*scale], fill=(255, 255, 255, 255), outline=(240, 225, 215, 255), width=3*scale)
    if r_lift > 20:
        cdraw.ellipse([rpx - 10*scale, rpy - 4*scale, rpx + 10*scale, rpy + 13*scale], fill=(255, 175, 185, 230))
        for tbx, tby in [(-13, -10), (0, -15), (13, -10)]:
            cdraw.ellipse([rpx + tbx*scale - 4*scale, rpy + tby*scale - 4*scale, rpx + tbx*scale + 4*scale, rpy + tby*scale + 4*scale], fill=(255, 175, 185, 230))

    # Floating hearts in Phase 3
    if t >= 7.2:
        h_age = (t - 7.2)
        for hi in range(3):
            ht = (h_age - hi * 0.8)
            if ht > 0:
                hx = cx - 110 * scale + int(math.sin(ht * 2) * 15 * scale)
                hy = head_cy - 120 * scale - int((ht % 2.5) * 60 * scale)
                h_size = int((14 + math.sin(ht*3)*2) * scale)
                h_alpha = int(max(0, min(220, 255 * (1.0 - (ht % 2.5) / 2.5))))
                # Draw heart
                h_img = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
                h_draw = ImageDraw.Draw(h_img)
                h_draw.ellipse([hx - h_size, hy - h_size, hx, hy], fill=(255, 120, 150, h_alpha))
                h_draw.ellipse([hx, hy - h_size, hx + h_size, hy], fill=(255, 120, 150, h_alpha))
                h_draw.polygon([(hx - h_size, hy - h_size // 3), (hx + h_size, hy - h_size // 3), (hx, hy + h_size)], fill=(255, 120, 150, h_alpha))
                cat = Image.alpha_composite(cat, h_img)

    bg = Image.alpha_composite(bg, cat)

    # 4. Golden Butterfly
    bf_img = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
    bf_d = ImageDraw.Draw(bf_img)
    flap_rate = 2.0 if t >= 6.8 else 9.0
    flap = math.cos(2 * math.pi * flap_rate * t)
    ww = int(36 * scale * abs(flap)) + 5
    wh = int(38 * scale)
    bf_d.ellipse([bf_x - ww - 3, bf_y - wh, bf_x - 3, bf_y + 6], fill=(255, 215, 50, 240))
    bf_d.ellipse([bf_x + 3, bf_y - wh, bf_x + ww + 3, bf_y + 6], fill=(255, 215, 50, 240))
    bf_d.ellipse([bf_x - int(ww*0.7) - 3, bf_y + 2, bf_x - 3, bf_y + int(wh*0.6)], fill=(255, 180, 40, 220))
    bf_d.ellipse([bf_x + 3, bf_y + 2, bf_x + int(ww*0.7) + 3, bf_y + int(wh*0.6)], fill=(255, 180, 40, 220))
    glow = bf_img.filter(ImageFilter.GaussianBlur(8 * scale))
    bg = Image.alpha_composite(bg, glow)
    bg = Image.alpha_composite(bg, bf_img)

    # Final downsampling
    frame_rgb = bg.resize((W, H), Image.Resampling.LANCZOS).convert('RGB')
    frame_bgr = cv2.cvtColor(np.array(frame_rgb), cv2.COLOR_RGB2BGR)
    writer.write(frame_bgr)

    if (frame_idx + 1) % 60 == 0:
        print(f'Rendered {frame_idx + 1}/{TOTAL_FRAMES} frames ({(frame_idx+1)/TOTAL_FRAMES*100:.1f}%)')

writer.release()
print('All video frames successfully written!')

# ----------------------------------------------------
# 3. Merge Audio & Video with FFmpeg
# ----------------------------------------------------
cmd = [
    'ffmpeg', '-y',
    '-i', str(RAW_VIDEO_PATH),
    '-i', str(AUDIO_PATH),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    str(FINAL_PREVIEW_PATH)
]
res = subprocess.run(cmd, capture_output=True, text=True)
if res.returncode == 0:
    print(f'Final MP4 rendered: {FINAL_PREVIEW_PATH} ({FINAL_PREVIEW_PATH.stat().st_size} bytes)')
else:
    print(f'FFmpeg merge error: {res.stderr}')
