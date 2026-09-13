from __future__ import annotations

import math
import os
import random
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path
from typing import Any

import cv2
from PIL import Image, ImageDraw, ImageFont
import numpy as np

# Ensure leo_capcut is importable
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from leo_capcut.adapters.jianying import JianyingAdapter
from leo_capcut.timeline_ir import validate_timeline

WIDTH = 1080
HEIGHT = 1920
FPS = 30
TOTAL_FRAMES = 180  # 6.0 seconds
DURATION_US = 6_000_000

# Try to find a font for PIL
FONT_PATH = "C:/Windows/Fonts/msyhbd.ttc"
if not os.path.exists(FONT_PATH):
    FONT_PATH = "C:/Windows/Fonts/simhei.ttf"
if not os.path.exists(FONT_PATH):
    FONT_PATH = "C:/Windows/Fonts/arial.ttf"


def get_font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except Exception:
        return ImageFont.load_default()


class Star:
    def __init__(self):
        self.reset()
        self.y = random.uniform(0, HEIGHT)

    def reset(self):
        self.x = random.uniform(0, WIDTH)
        self.y = 0
        self.speed = random.uniform(2.0, 8.0)
        self.radius = random.uniform(1.0, 3.5)
        self.brightness = random.randint(140, 255)
        self.angle = math.atan2(self.y - HEIGHT / 2, self.x - WIDTH / 2)
        self.dist = math.hypot(self.x - WIDTH / 2, self.y - HEIGHT / 2)


class Particle:
    def __init__(self, x: float, y: float, vx: float, vy: float, color: tuple[int, int, int], life: int, radius: float = 3.0):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.color = color
        self.max_life = life
        self.life = life
        self.radius = radius

    def update(self):
        self.x += self.vx
        self.y += self.vy
        self.life -= 1

    @property
    def alpha(self) -> float:
        return max(0.0, self.life / self.max_life)


def render_core_animation(output_path: Path) -> Path:
    print("--> Rendering 60fps/30fps fluid motion animation frames...")
    temp_raw = output_path.with_suffix(".raw.mp4")
    writer = cv2.VideoWriter(str(temp_raw), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (WIDTH, HEIGHT))

    random.seed(42)
    np.random.seed(42)

    stars = [Star() for _ in range(160)]
    particles: list[Particle] = []
    core_x, core_y = WIDTH / 2, HEIGHT / 2

    font_title = get_font(48)
    font_sub = get_font(32)
    font_mono = get_font(26)

    for f in range(TOTAL_FRAMES):
        t = f / FPS  # current time in seconds
        frame = Image.new("RGBA", (WIDTH, HEIGHT), (8, 6, 18, 255))
        draw = ImageDraw.Draw(frame)

        # -------------------------------------------------------------
        # PHASE 1: Frames 0 - 60 (0.0s - 2.0s) [能量核心充能]
        # -------------------------------------------------------------
        if f < 60:
            progress = f / 60.0
            # 1. Cosmic background gradient
            grad = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
            g_draw = ImageDraw.Draw(grad)
            center_color = (15, 35, 75, int(180 * (0.5 + 0.5 * math.sin(f * 0.15))))
            g_draw.ellipse([core_x - 500, core_y - 500, core_x + 500, core_y + 500], fill=center_color)
            frame = Image.alpha_composite(frame, grad)
            draw = ImageDraw.Draw(frame)

            # 2. Drifting stars
            for s in stars:
                s.y += s.speed
                if s.y > HEIGHT:
                    s.reset()
                alpha_val = int(s.brightness * (0.6 + 0.4 * math.sin(f * 0.1 + s.x)))
                draw.ellipse([s.x - s.radius, s.y - s.radius, s.x + s.radius, s.y + s.radius], fill=(220, 240, 255, alpha_val))

            # 3. Inflowing energy particles towards core
            if f % 2 == 0:
                p_angle = random.uniform(0, math.pi * 2)
                p_dist = random.uniform(300, 520)
                px = core_x + math.cos(p_angle) * p_dist
                py = core_y + math.sin(p_angle) * p_dist
                speed = random.uniform(10.0, 16.0)
                vx = -math.cos(p_angle) * speed
                vy = -math.sin(p_angle) * speed
                particles.append(Particle(px, py, vx, vy, (0, 240, 255), life=35, radius=random.uniform(2, 4)))

            for p in list(particles):
                p.update()
                if p.life <= 0:
                    particles.remove(p)
                else:
                    a = int(255 * p.alpha)
                    c = p.color + (a,)
                    draw.ellipse([p.x - p.radius, p.y - p.radius, p.x + p.radius, p.y + p.radius], fill=c)

            # 4. Concentric rotating HUD rings
            rot1 = f * 0.04
            rot2 = -f * 0.06
            rot3 = f * 0.09

            # Ring 1 (Outer dashed)
            r1 = 360
            draw.arc([core_x - r1, core_y - r1, core_x + r1, core_y + r1], start=math.degrees(rot1), end=math.degrees(rot1) + 260, fill=(0, 200, 255, 180), width=3)
            # Ring 2 (Middle segmented)
            r2 = 280
            for seg in range(6):
                ang = rot2 + seg * (math.pi / 3)
                draw.arc([core_x - r2, core_y - r2, core_x + r2, core_y + r2], start=math.degrees(ang), end=math.degrees(ang) + 40, fill=(180, 80, 255, 220), width=4)
            # Ring 3 (Inner progress gauge)
            r3 = 200
            end_deg = -90 + progress * 360
            draw.arc([core_x - r3, core_y - r3, core_x + r3, core_y + r3], start=-90, end=end_deg, fill=(0, 255, 200, 255), width=8)

            # 5. Core Pulsing Reactor
            pulse = math.sin(f * 0.25) * 15
            core_r = 110 + pulse
            draw.ellipse([core_x - core_r, core_y - core_r, core_x + core_r, core_y + core_r], fill=(0, 220, 255, 200), outline=(255, 255, 255, 255), width=4)
            draw.ellipse([core_x - core_r * 0.6, core_y - core_r * 0.6, core_x + core_r * 0.6, core_y + core_r * 0.6], fill=(255, 255, 255, 240))

            # 6. Tech Readouts
            pct = int(progress * 99)
            draw.text((core_x, core_y + 440), f"REACTOR CHARGE: {pct}%", fill=(0, 255, 255, 230), font=font_mono, anchor="mm")
            draw.text((core_x, core_y + 480), f"STABILIZER: ACTIVE // FLUX: {340 + f * 11} GW", fill=(160, 200, 255, 180), font=font_mono, anchor="mm")

        # -------------------------------------------------------------
        # PHASE 2: Frames 60 - 120 (2.0s - 4.0s) [火箭光速跃迁]
        # -------------------------------------------------------------
        elif f < 120:
            p2_f = f - 60
            p2_t = p2_f / 60.0

            # 1. Explosive initial flash and expanding shockwave
            if p2_f < 20:
                flash_alpha = int(255 * (1.0 - p2_f / 20.0))
                flash = Image.new("RGBA", (WIDTH, HEIGHT), (220, 250, 255, flash_alpha))
                frame = Image.alpha_composite(frame, flash)
                draw = ImageDraw.Draw(frame)

            sw_r = p2_f * 45
            if sw_r < 1400:
                sw_alpha = max(0, int(220 * (1.0 - sw_r / 1400)))
                draw.ellipse([core_x - sw_r, core_y - sw_r, core_x + sw_r, core_y + sw_r], outline=(0, 255, 255, sw_alpha), width=max(2, int(8 * (1 - p2_t))))

            # 2. Camera Shake (jitter)
            shake_amp = max(0.0, (1.0 - p2_t * 0.8) * 16.0)
            shake_x = (random.random() - 0.5) * shake_amp
            shake_y = (random.random() - 0.5) * shake_amp

            # 3. Hyperdrive Warp Speed Lines (Radial streaks radiating from vanishing point)
            vp_x = core_x + shake_x
            vp_y = core_y + 200 + shake_y
            for i in range(45):
                angle = (i / 45.0) * math.pi * 2 + f * 0.05
                inner_d = 80 + (p2_f * 15 + i * 27) % 350
                outer_d = inner_d + 180 + p2_t * 500
                x1 = vp_x + math.cos(angle) * inner_d
                y1 = vp_y + math.sin(angle) * inner_d
                x2 = vp_x + math.cos(angle) * outer_d
                y2 = vp_y + math.sin(angle) * outer_d
                draw.line([(x1, y1), (x2, y2)], fill=(120, 220, 255, int(190 * min(1.0, p2_t * 2))), width=random.randint(2, 5))

            # 4. Accelerating Rocket / Starship
            # Physics: smooth acceleration curve
            ease_y = p2_t ** 2.2
            ship_y = 1500 - ease_y * 1400 + shake_y
            ship_x = core_x + shake_x

            # Multi-layer Rocket Flame / Plasma Plume
            flame_len = 160 + math.sin(f * 1.8) * 35 + p2_t * 90
            flame_w = 40 + math.sin(f * 1.2) * 8
            # Outer flame (Orange / Red)
            flame_poly_outer = [
                (ship_x - flame_w, ship_y + 80),
                (ship_x + flame_w, ship_y + 80),
                (ship_x, ship_y + 80 + flame_len),
            ]
            draw.polygon(flame_poly_outer, fill=(255, 90, 20, 230))
            # Inner core flame (Cyan / White)
            flame_poly_inner = [
                (ship_x - flame_w * 0.5, ship_y + 80),
                (ship_x + flame_w * 0.5, ship_y + 80),
                (ship_x, ship_y + 80 + flame_len * 0.65),
            ]
            draw.polygon(flame_poly_inner, fill=(180, 240, 255, 255))

            # Spark particles from exhaust
            for _ in range(3):
                sp_vx = random.uniform(-6, 6)
                sp_vy = random.uniform(15, 30)
                particles.append(Particle(ship_x + random.uniform(-15, 15), ship_y + 80, sp_vx, sp_vy, (255, 200, 50), life=20, radius=random.uniform(3, 6)))

            for p in list(particles):
                p.update()
                if p.life <= 0:
                    particles.remove(p)
                else:
                    a = int(255 * p.alpha)
                    draw.ellipse([p.x - p.radius, p.y - p.radius, p.x + p.radius, p.y + p.radius], fill=p.color + (a,))

            # Vector Starship Geometry
            # Fuselage
            ship_body = [
                (ship_x, ship_y - 120),       # Nose
                (ship_x + 35, ship_y - 20),   # Upper shoulder right
                (ship_x + 40, ship_y + 70),   # Lower body right
                (ship_x + 95, ship_y + 85),   # Wing tip right
                (ship_x + 30, ship_y + 80),   # Engine mount right
                (ship_x - 30, ship_y + 80),   # Engine mount left
                (ship_x - 95, ship_y + 85),   # Wing tip left
                (ship_x - 40, ship_y + 70),   # Lower body left
                (ship_x - 35, ship_y - 20),   # Upper shoulder left
            ]
            draw.polygon(ship_body, fill=(240, 245, 255, 255), outline=(0, 220, 255, 255), width=3)
            # Cockpit canopy
            canopy = [
                (ship_x, ship_y - 80),
                (ship_x + 14, ship_y - 30),
                (ship_x - 14, ship_y - 30),
            ]
            draw.polygon(canopy, fill=(0, 180, 255, 255))

            draw.text((ship_x, ship_y + 240), f"VELOCITY: {round(p2_t * 9.9, 1)} C // WARP", fill=(255, 180, 0, 220), font=font_mono, anchor="mm")

        # -------------------------------------------------------------
        # PHASE 3: Frames 120 - 180 (4.0s - 6.0s) [新星系降落与星环展开]
        # -------------------------------------------------------------
        else:
            p3_f = f - 120
            p3_t = p3_f / 60.0
            ease_in = 1.0 - (1.0 - p3_t) ** 2

            # 1. Deep space with nebula glow
            for s in stars:
                s.y += s.speed * 0.4
                if s.y > HEIGHT:
                    s.reset()
                alpha_val = int(s.brightness * (0.7 + 0.3 * math.sin(f * 0.08 + s.x)))
                draw.ellipse([s.x - s.radius, s.y - s.radius, s.x + s.radius, s.y + s.radius], fill=(230, 245, 255, alpha_val))

            # 2. Majestic Ringed Exoplanet
            planet_center_x = WIDTH / 2
            planet_center_y = 620 - (1.0 - ease_in) * 120
            planet_r = 210

            # Back of the planetary ring (drawn behind planet)
            ring_w = 480
            ring_h = 100
            tilt = -18  # degrees
            # We can draw the ring as an ellipse on a rotated canvas
            ring_img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
            r_draw = ImageDraw.Draw(ring_img)
            r_draw.ellipse([planet_center_x - ring_w, planet_center_y - ring_h, planet_center_x + ring_w, planet_center_y + ring_h], outline=(180, 120, 255, 180), width=18)
            r_draw.ellipse([planet_center_x - ring_w * 0.85, planet_center_y - ring_h * 0.85, planet_center_x + ring_w * 0.85, planet_center_y + ring_h * 0.85], outline=(0, 230, 255, 140), width=8)
            ring_img = ring_img.rotate(tilt, center=(planet_center_x, planet_center_y))
            frame = Image.alpha_composite(frame, ring_img)
            draw = ImageDraw.Draw(frame)

            # Planet sphere body
            draw.ellipse([planet_center_x - planet_r, planet_center_y - planet_r, planet_center_x + planet_r, planet_center_y + planet_r], fill=(25, 45, 95, 255), outline=(0, 240, 255, 255), width=4)
            # Atmosphere rim highlight
            draw.arc([planet_center_x - planet_r, planet_center_y - planet_r, planet_center_x + planet_r, planet_center_y + planet_r], start=180, end=360, fill=(120, 255, 255, 240), width=6)

            # Front of the planetary ring (drawn in front of planet)
            ring_front = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
            rf_draw = ImageDraw.Draw(ring_front)
            rf_draw.arc([planet_center_x - ring_w, planet_center_y - ring_h, planet_center_x + ring_w, planet_center_y + ring_h], start=0, end=180, fill=(200, 150, 255, 230), width=18)
            rf_draw.arc([planet_center_x - ring_w * 0.85, planet_center_y - ring_h * 0.85, planet_center_x + ring_w * 0.85, planet_center_y + ring_h * 0.85], start=0, end=180, fill=(0, 240, 255, 180), width=8)
            ring_front = ring_front.rotate(tilt, center=(planet_center_x, planet_center_y))
            frame = Image.alpha_composite(frame, ring_front)
            draw = ImageDraw.Draw(frame)

            # 3. Cruising Starship (stabilizing and hovering)
            hover_y = 1360 + math.sin(p3_f * 0.12) * 18
            ship_x = WIDTH / 2 + math.sin(p3_f * 0.08) * 12
            ship_scale = 0.82

            # Idle Thruster glow
            flame_len = 50 + math.sin(p3_f * 0.3) * 10
            draw.polygon([
                (ship_x - 20 * ship_scale, hover_y + 70 * ship_scale),
                (ship_x + 20 * ship_scale, hover_y + 70 * ship_scale),
                (ship_x, hover_y + (70 + flame_len) * ship_scale),
            ], fill=(0, 220, 255, 220))

            ship_body = [
                (ship_x, hover_y - 120 * ship_scale),
                (ship_x + 35 * ship_scale, hover_y - 20 * ship_scale),
                (ship_x + 40 * ship_scale, hover_y + 70 * ship_scale),
                (ship_x + 95 * ship_scale, hover_y + 85 * ship_scale),
                (ship_x + 30 * ship_scale, hover_y + 80 * ship_scale),
                (ship_x - 30 * ship_scale, hover_y + 80 * ship_scale),
                (ship_x - 95 * ship_scale, hover_y + 85 * ship_scale),
                (ship_x - 40 * ship_scale, hover_y + 70 * ship_scale),
                (ship_x - 35 * ship_scale, hover_y - 20 * ship_scale),
            ]
            draw.polygon(ship_body, fill=(240, 248, 255, 255), outline=(0, 220, 255, 255), width=3)

            # 4. Target Acquisition Reticle (HUD lock-on)
            reticle_r = max(60, int(160 * (1.0 - min(1.0, p3_t * 1.5))))
            draw.rectangle([planet_center_x - reticle_r, planet_center_y - reticle_r, planet_center_x + reticle_r, planet_center_y + reticle_r], outline=(0, 255, 200, 200), width=2)
            draw.text((planet_center_x, planet_center_y + 260), "DESTINATION LOCKED // EXOPLANET-PRIME", fill=(0, 255, 200, 220), font=font_mono, anchor="mm")

        # Convert to BGR for cv2
        frame_bgr = cv2.cvtColor(np.array(frame), cv2.COLOR_RGBA2BGR)
        writer.write(frame_bgr)

    writer.release()

    # Remux through ffmpeg with libx264 for high compatibility
    cmd = [
        "ffmpeg", "-y",
        "-i", str(temp_raw),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        str(output_path)
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    if temp_raw.exists():
        temp_raw.unlink()
    print(f"--> Core animation video generated at: {output_path}")
    return output_path


def render_hud_overlay_video(output_path: Path) -> Path:
    print("--> Rendering HUD PiP overlay video...")
    temp_raw = output_path.with_suffix(".raw.mp4")
    writer = cv2.VideoWriter(str(temp_raw), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (WIDTH, HEIGHT))

    for f in range(TOTAL_FRAMES):
        frame = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 255))
        draw = ImageDraw.Draw(frame)

        # Draw a high-tech tactical HUD compass in upper left
        cx, cy = 180, 240
        rot = f * 0.05

        # Compass outer ring
        draw.ellipse([cx - 90, cy - 90, cx + 90, cy + 90], outline=(0, 240, 255, 160), width=2)
        # Ticks
        for i in range(12):
            ang = rot + i * (math.pi / 6)
            x1 = cx + math.cos(ang) * 75
            y1 = cy + math.sin(ang) * 75
            x2 = cx + math.cos(ang) * 88
            y2 = cy + math.sin(ang) * 88
            draw.line([(x1, y1), (x2, y2)], fill=(0, 255, 200, 180), width=2)

        # Crosshairs
        draw.line([(cx - 110, cy), (cx - 70, cy)], fill=(0, 255, 255, 200), width=2)
        draw.line([(cx + 70, cy), (cx + 110, cy)], fill=(0, 255, 255, 200), width=2)
        draw.line([(cx, cy - 110), (cx, cy - 70)], fill=(0, 255, 255, 200), width=2)
        draw.line([(cx, cy + 70), (cx, cy + 110)], fill=(0, 255, 255, 200), width=2)

        # Frame counter
        font = get_font(22)
        draw.text((cx, cy + 120), f"SYS_T: {f:03d} // LCK", fill=(0, 255, 255, 220), font=font, anchor="mm")

        frame_bgr = cv2.cvtColor(np.array(frame), cv2.COLOR_RGBA2BGR)
        writer.write(frame_bgr)

    writer.release()
    cmd = [
        "ffmpeg", "-y",
        "-i", str(temp_raw),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        str(output_path)
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    if temp_raw.exists():
        temp_raw.unlink()
    print(f"--> HUD PiP overlay video generated at: {output_path}")
    return output_path


def render_sci_fi_audio(output_path: Path) -> Path:
    print("--> Synthesizing cinematic sci-fi sound design...")
    sr = 44100
    dur = 6.0
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    audio = np.zeros_like(t)

    # 1. Riser (0.0s - 2.0s)
    m1 = t < 2.0
    t1 = t[m1]
    f_rise = 120.0 + 520.0 * (t1 / 2.0) ** 2.2
    phase1 = 2 * np.pi * np.cumsum(f_rise) / sr
    audio[m1] += 0.35 * np.sin(phase1) * (0.2 + 0.8 * (t1 / 2.0))
    audio[m1] += 0.20 * np.sin(2 * np.pi * 55.0 * t1)  # Reactor Sub-hum

    # 2. Impact Boom & Rocket Roar (2.0s - 4.0s)
    m2 = (t >= 2.0) & (t < 4.0)
    dt2 = t[m2] - 2.0
    boom = 0.65 * np.sin(2 * np.pi * 52 * np.exp(-dt2 * 3.5) * dt2) * np.exp(-dt2 * 1.8)
    # Filtered white noise for engine exhaust
    noise = 0.35 * np.random.uniform(-1, 1, len(dt2)) * np.exp(-dt2 * 1.2)
    audio[m2] += boom + noise

    # 3. Warp Whoosh sweep (2.1s - 3.8s)
    m_whoosh = (t >= 2.1) & (t < 3.8)
    dt_w = t[m_whoosh] - 2.1
    f_w = 400.0 * np.exp(-dt_w * 2.0) + 180.0
    audio[m_whoosh] += 0.25 * np.sin(2 * np.pi * np.cumsum(f_w) / sr)

    # 4. Ambient Pad & Crystal Chimes (3.8s - 6.0s)
    m3 = t >= 3.8
    dt3 = t[m3] - 3.8
    # E-minor ethereal pad (E4, G4, B4, E5)
    pad = 0.18 * np.sin(2 * np.pi * 329.63 * dt3) * (1 - np.exp(-dt3 * 3)) * np.exp(-dt3 * 0.35)
    pad += 0.15 * np.sin(2 * np.pi * 392.00 * dt3) * (1 - np.exp(-dt3 * 3)) * np.exp(-dt3 * 0.35)
    pad += 0.15 * np.sin(2 * np.pi * 493.88 * dt3) * (1 - np.exp(-dt3 * 3)) * np.exp(-dt3 * 0.35)
    pad += 0.12 * np.sin(2 * np.pi * 659.25 * dt3) * (1 - np.exp(-dt3 * 3)) * np.exp(-dt3 * 0.35)
    audio[m3] += pad

    # Fade out at the very end (5.5s - 6.0s)
    m_fade = t >= 5.5
    fade_factor = (6.0 - t[m_fade]) / 0.5
    audio[m_fade] *= fade_factor

    audio = np.clip(audio, -0.92, 0.92)
    audio_int16 = (audio * 32767).astype(np.int16)

    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(audio_int16.tobytes())

    print(f"--> Audio sound design synthesized at: {output_path}")
    return output_path


def main():
    print("================================================================")
    print("🚀 开始制作真正的原生动画验证工程：【探星者：零点跃迁】")
    print("================================================================")

    work_dir = Path("D:/agent-transfer/lib/skills/leo-capcut/assets/warp_animation_assets")
    work_dir.mkdir(parents=True, exist_ok=True)

    video_asset = work_dir / "stargazer_core.mp4"
    hud_asset = work_dir / "hud_overlay.mp4"
    audio_asset = work_dir / "stargazer_sfx.wav"

    # Step 1: Render genuine motion graphics video and sound
    if not video_asset.exists() or video_asset.stat().st_size == 0:
        render_core_animation(video_asset)
    else:
        print(f"--> Using cached core animation: {video_asset}")

    if not hud_asset.exists() or hud_asset.stat().st_size == 0:
        render_hud_overlay_video(hud_asset)
    else:
        print(f"--> Using cached HUD overlay: {hud_asset}")

    if not audio_asset.exists() or audio_asset.stat().st_size == 0:
        render_sci_fi_audio(audio_asset)
    else:
        print(f"--> Using cached audio SFX: {audio_asset}")

    # Step 2: Assemble Timeline IR with all advanced capabilities
    print("\n--> Assembling full multi-track Timeline IR with Jianying native features...")
    timeline_payload = {
        "schema_version": "1.0",
        "project_name": "探星者零点跃迁",
        "canvas": {"width": WIDTH, "height": HEIGHT, "fps": FPS},
        "duration_us": DURATION_US,
        "assets": [
            {"id": "main_video", "kind": "video", "uri": str(video_asset), "duration_us": DURATION_US},
            {"id": "hud_pip", "kind": "video", "uri": str(hud_asset), "duration_us": DURATION_US},
            {"id": "sfx_audio", "kind": "audio", "uri": str(audio_asset), "duration_us": DURATION_US},
        ],
        "tracks": [
            # Track 1: Main Video with native cinematic color grading and subtle camera push-in keyframes
            {
                "id": "trk_video_main",
                "type": "video",
                "name": "主视轨_核心动画",
                "clips": [
                    {
                        "id": "clip_main_v",
                        "start_us": 0,
                        "duration_us": DURATION_US,
                        "asset_id": "main_video",
                        "filter_type": "1980",  # Native Jianying Film LUT Filter (Anti-hallucination normalized)
                        "effect_type": "90s",   # Native Jianying 90s visual grain effect
                        "keyframes": [
                            {"property": "scale_x", "time_offset": 0, "value": 1.0},
                            {"property": "scale_y", "time_offset": 0, "value": 1.0},
                            {"property": "scale_x", "time_offset": DURATION_US, "value": 1.08},
                            {"property": "scale_y", "time_offset": DURATION_US, "value": 1.08},
                        ],
                    }
                ],
            },
            # Track 2: PiP Holographic HUD Overlay with Blend Mode '滤色'
            {
                "id": "trk_video_pip",
                "type": "video",
                "name": "画中画_全息战术罗盘",
                "clips": [
                    {
                        "id": "clip_hud_pip",
                        "start_us": 0,
                        "duration_us": DURATION_US,
                        "asset_id": "hud_pip",
                        "mix_mode": "滤色",  # Blend mode: Screen
                    }
                ],
            },
            # Track 3: Kinetic Subtitles & Titles with Built-in Animations & Flower Text
            {
                "id": "trk_text_kinetic",
                "type": "text",
                "name": "动力学字幕与花字",
                "clips": [
                    {
                        "id": "txt_phase1",
                        "start_us": 0,
                        "duration_us": 2_000_000,
                        "text": "⚡ 反应堆核心：聚能 99%",
                        "font": "宋体",
                        "font_size": 9.0,
                        "text_color": "#00FFFF",
                        "text_border_color": "#002244",
                        "text_border_width": 25.0,
                        "text_animation": "打字机",  # Native typewriter intro animation
                        "text_animation_duration_us": 1_000_000,
                        "transform_y": -0.68,
                    },
                    {
                        "id": "txt_phase2",
                        "start_us": 2_000_000,
                        "duration_us": 2_000_000,
                        "text": "🚀 曲速引擎 全功率点火！",
                        "font": "宋体",
                        "font_size": 10.0,
                        "text_color": "#FF6600",
                        "text_effect": "潮酷发光立体花字",  # Flower text
                        "text_animation": "冲屏位移",      # Punch screen motion intro
                        "text_animation_duration_us": 500_000,
                        "transform_y": -0.68,
                    },
                    {
                        "id": "txt_phase3",
                        "start_us": 4_000_000,
                        "duration_us": 2_000_000,
                        "text": "🪐 目标抵达：新星纪元",
                        "font": "宋体",
                        "font_size": 10.5,
                        "text_color": "#FFD700",
                        "text_border_color": "#000000",
                        "text_border_width": 35.0,
                        "text_animation_loop": "扫光",   # Looping light sweep animation
                        "transform_y": -0.68,
                    },
                ],
            },
            # Track 4: Audio Engineering with Volume ducking
            {
                "id": "trk_audio_sfx",
                "type": "audio",
                "name": "电影级科幻音效",
                "clips": [
                    {
                        "id": "clip_audio_sfx",
                        "start_us": 0,
                        "duration_us": DURATION_US,
                        "asset_id": "sfx_audio",
                        "volume": 0.95,
                        "keyframes": [
                            {"time_offset": 0, "value": 0.95},
                            {"time_offset": 5_200_000, "value": 0.95},
                            {"time_offset": 6_000_000, "value": 0.0},
                        ],
                    }
                ],
            },
        ],
    }

    timeline = validate_timeline(timeline_payload)
    print("--> Timeline IR successfully validated.")

    # Step 3: Publish to Jianying Pro Drafts
    adapter = JianyingAdapter.detect("windows")
    proj_name = f"探星者零点跃迁_{int(time.time())}"
    print(f"\n--> Publishing project directly to Jianying Pro local drafts: {proj_name}...")
    publish_result = adapter.publish(timeline, project_name=proj_name, register=True)
    print(f"--> Successfully created and registered Jianying project: {proj_name} (ID: {publish_result.project_id})")
    print(f"--> Draft directory: {publish_result.draft_dir}")

    # Step 4: Render a standalone combined MP4 preview for direct playback!
    preview_output = Path("D:/agent-transfer/lib/skills/leo-capcut/verified_animation_preview.mp4")
    print(f"\n--> Rendering standalone MP4 preview for instant viewing to: {preview_output} ...")
    render_cmd = [
        "ffmpeg", "-y",
        "-i", str(video_asset),
        "-i", str(hud_asset),
        "-i", str(audio_asset),
        "-filter_complex",
        "[0:v][1:v]blend=all_mode='screen':all_opacity=0.85[vout]",
        "-map", "[vout]",
        "-map", "2:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19",
        "-c:a", "aac", "-b:a", "192k",
        "-t", "6",
        str(preview_output)
    ]
    subprocess.run(render_cmd, check=True, capture_output=True)
    print(f"--> Standalone preview MP4 successfully generated at: {preview_output}")

    print("\n================================================================")
    print("✅ 验证视频制作完成！")
    print(f"1. 剪映工程草稿位置: {publish_result.draft_dir}")
    print(f"2. 本地即时播放 MP4: {preview_output}")
    print("================================================================")


if __name__ == "__main__":
    main()
