import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fmtTime, writeJson } from "./store.mjs";

// ---------------- process helpers ----------------

export function exec(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  return { ok: !res.error && res.status === 0, missing: res.error?.code === "ENOENT", stdout: res.stdout || "", stderr: res.stderr || "", error: res.error };
}

const ffmpeg = (args) => exec("ffmpeg", ["-hide_banner", "-nostdin", ...args]);

export const toolExists = (cmd) => !exec(cmd, ["-version"]).missing;

export function probe(file) {
  const res = exec("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (res.missing) throw new Error("未找到 ffprobe，请先安装 ffmpeg");
  if (!res.ok) throw new Error(`视频无法读取：${res.stderr.trim().slice(0, 300)}`);
  const data = JSON.parse(res.stdout);
  const video = data.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const duration = Number(data.format?.duration) || Number(video?.duration) || 0;
  if (!duration) throw new Error("视频无法读取：取不到时长");
  return {
    duration,
    width: video?.width || 0,
    height: video?.height || 0,
    hasVideo: Boolean(video),
    hasAudio: data.streams.some((s) => s.codec_type === "audio"),
    subtitleStreams: data.streams.filter((s) => s.codec_type === "subtitle"),
  };
}

// ---------------- subtitles ----------------

const CUE_TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSeconds = (m) => Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
const cleanCueLine = (line) => line.replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "").replace(/&nbsp;|\\[hNn]/g, " ").replace(/\s+/g, " ").trim();

/** Parses SRT or VTT, folding the rolling duplicates of platform auto captions. */
export function parseCues(text) {
  const cues = [];
  for (const block of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [from, to] = lines[at].split("-->").map((part) => part.match(CUE_TIME));
    if (!from || !to) continue;
    const textLines = lines.slice(at + 1).map(cleanCueLine).filter(Boolean);
    const start = toSeconds(from);
    const end = toSeconds(to);
    const prev = cues.at(-1);
    const prevLines = prev?.lines || [];
    let skip = 0;
    while (skip < textLines.length && prevLines.includes(textLines[skip])) skip += 1;
    const fresh = textLines.slice(skip);
    if (!fresh.length) {
      if (prev && textLines.length) prev.end = Math.max(prev.end, end);
      continue;
    }
    cues.push({ start, end, lines: fresh, text: fresh.join(" ") });
  }
  return cues.map(({ start, end, text: t }) => ({ start, end, text: t }));
}

const isHumanLang = (lang) => !/live_chat|danmaku|rechat/i.test(lang);
/** A platform's machine translation of its own captions says nothing the video itself said. */
export const isMachineTranslated = (info, lang) => !info?.subtitles?.[lang] && (info?.automatic_captions?.[lang] || []).some((f) => /[?&]tlang=/.test(f.url || ""));
/** Bilibili lists its AI captions (ai-zh) next to uploaded ones, so the name decides before the list does. */
export function platformSubtitleSource(info, lang) {
  if (/^ai-/i.test(lang)) return "platform_auto";
  return info?.subtitles && Object.hasOwn(info.subtitles, lang) ? "platform_manual" : "platform_auto";
}

const baseLang = (lang) => String(lang || "").split("-")[0].toLowerCase();

/**
 * The uploaded subtitle track in the video's own language, if any. A translated track is not what was said,
 * and with an unknown video language a track can't be shown to be the original, so both return null.
 */
export function originalManualTrack(tracks, info) {
  if (!info?.language) return null;
  return tracks.find((t) => t.source === "platform_manual" && baseLang(t.lang) === baseLang(info.language)) || null;
}

const TEXT_SUB_CODECS = new Set(["subrip", "mov_text", "ass", "ssa", "webvtt", "text"]);
const SUB_EXTS = new Set([".srt", ".vtt"]);

function collectSubtitleInputs(runDir, run, info, media) {
  const inputs = [];
  const subDir = path.join(runDir, "subtitles");
  fs.mkdirSync(subDir, { recursive: true });
  // yt-dlp --convert-subs always leaves subtitles beside the video.
  for (const file of fs.readdirSync(runDir)) {
    if (file.startsWith("source.") && SUB_EXTS.has(path.extname(file))) fs.renameSync(path.join(runDir, file), path.join(subDir, file));
  }
  for (const file of fs.readdirSync(subDir)) {
    if (!SUB_EXTS.has(path.extname(file)) || !file.startsWith("source.")) continue;
    const lang = file.replace(/\.[^.]+$/, "").split(".").at(-1);
    if (!isHumanLang(lang) || isMachineTranslated(info, lang)) continue;
    inputs.push({ track: lang, lang, source: platformSubtitleSource(info, lang), file: path.join(subDir, file) });
  }
  if (run.local_path) {
    const dir = path.dirname(run.local_path);
    const stem = path.basename(run.local_path, path.extname(run.local_path));
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file);
      if (!SUB_EXTS.has(ext) || !file.startsWith(stem)) continue;
      const lang = file.slice(stem.length, -ext.length).replace(/^[._-]/, "") || null;
      inputs.push({ track: lang ? `sidecar-${lang}` : "sidecar", lang, source: "sidecar", file: path.join(dir, file) });
    }
  }
  media.subtitleStreams.forEach((stream, index) => {
    if (!TEXT_SUB_CODECS.has(stream.codec_name)) return;
    const lang = stream.tags?.language || null;
    const track = `embedded-${index}${lang ? `-${lang}` : ""}`;
    const out = path.join(subDir, `${track}.srt`);
    if (ffmpeg(["-y", "-i", run.source, "-map", `0:s:${index}`, "-f", "srt", out]).ok) inputs.push({ track, lang, source: "embedded", file: out });
  });
  return inputs;
}

const transcriptLine = (s) => `${s.id} [${fmtTime(s.start)}-${fmtTime(s.end)}] ${s.text}`;

/** Normalizes every subtitle source into subtitles/<track>.json and .txt with stable SUB ids. */
export function normalizeSubtitles(runDir, run, info, media) {
  const tracks = [];
  let counter = 0;
  for (const input of collectSubtitleInputs(runDir, run, info, media)) {
    const cues = parseCues(fs.readFileSync(input.file, "utf8"));
    if (!cues.length) continue;
    const segments = cues.map((c) => ({ id: `SUB-S${String((counter += 1)).padStart(5, "0")}`, ...c }));
    const track = input.track.replace(/[^\w.-]/g, "_");
    writeJson(path.join(runDir, "subtitles", `${track}.json`), { track, lang: input.lang, source: input.source, segments });
    fs.writeFileSync(path.join(runDir, "subtitles", `${track}.txt`), `${segments.map(transcriptLine).join("\n")}\n`, "utf8");
    tracks.push({ track, lang: input.lang, source: input.source, segments: segments.length, text: `subtitles/${track}.txt` });
  }
  return tracks;
}

// ---------------- transcription ----------------
// The omnivoice skill does the transcribing; this side only prepares the audio and imports the result.

/** Whisper emits text over silence; these are its own no-speech thresholds. */
export function keepSegment(s) {
  if (!String(s.text || "").trim()) return false;
  return !(Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -1);
}

export function extractAudio(source, output) {
  const res = ffmpeg(["-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output]);
  if (!res.ok) throw new Error(`音频提取失败：${res.stderr.trim().slice(-300)}`);
}

/** Normalizes an OpenAI-style verbose_json response into transcript.json and transcript.txt with ASR ids. */
export function importTranscript(runDir, data, duration) {
  if (!data || typeof data !== "object" || !("segments" in data || "text" in data)) {
    throw new Error(`这不是转写结果，收到：${JSON.stringify(data).slice(0, 300)}`);
  }
  const raw = data.segments?.length ? data.segments : data.text ? [{ start: 0, end: duration, text: data.text }] : [];
  const segments = raw.filter(keepSegment).map((s, i) => ({
    id: `ASR-S${String(i + 1).padStart(5, "0")}`,
    start: Number(s.start),
    end: Number(s.end),
    text: String(s.text).trim(),
  }));
  writeJson(path.join(runDir, "transcript.json"), { language: data.language || null, segments });
  fs.writeFileSync(path.join(runDir, "transcript.txt"), segments.length ? `${segments.map(transcriptLine).join("\n")}\n` : "", "utf8");
  return { status: segments.length ? "ok" : "no_speech", language: data.language || null, segments: segments.length };
}

// ---------------- frames ----------------

/** Initial values; override with --max-interval when a video needs denser or sparser coverage. */
export function maxIntervalFor(duration) {
  if (duration <= 180) return 1;
  if (duration <= 1800) return 5;
  if (duration <= 7200) return 15;
  return 30;
}

/** One frame mid-shot, more inside long shots, so no two neighbours exceed maxInterval. */
export function planFrames({ duration, cuts, maxInterval }) {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < duration).sort((a, b) => a - b), duration];
  const plan = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const [start, end] = [edges[i], edges[i + 1]];
    const length = end - start;
    if (length <= 0) continue;
    const count = Math.max(1, Math.ceil(length / maxInterval));
    for (let k = 0; k < count; k += 1) {
      plan.push({ t: Number((start + ((k + 0.5) * length) / count).toFixed(3)), reason: count === 1 ? "shot" : "interval" });
    }
  }
  const tail = Number((duration - 0.2).toFixed(3));
  if (tail > 0 && (!plan.length || plan.at(-1).t < tail - 0.5)) plan.push({ t: tail, reason: "tail" });
  return plan;
}

export function detectCuts(source, threshold = 10) {
  const res = ffmpeg(["-nostats", "-i", source, "-an", "-sn", "-vf", `scale=320:-2,scdet=threshold=${threshold}`, "-f", "null", "-"]);
  return [...res.stderr.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => Number(m[1]));
}

function extractOne(source, t, out) {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", String(t), "-i", source, "-frames:v", "1", "-q:v", "3",
      "-vf", "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease", out], { stdio: "ignore" });
    child.on("close", () => resolve(fs.existsSync(out) && fs.statSync(out).size > 0));
    child.on("error", () => resolve(false));
  });
}

async function extractAll(source, plan, rawDir) {
  const workers = Math.min(6, os.availableParallelism());
  const done = new Array(plan.length).fill(false);
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < plan.length) {
      const i = next;
      next += 1;
      done[i] = await extractOne(source, plan[i].t, path.join(rawDir, `c${i}.jpg`));
    }
  }));
  return done;
}

const GRID = { width: 96, height: 54 };
const CELL_DELTA = 8; // 0-255 brightness shift that counts as a changed cell; JPEG noise stays below it
const MIN_CHANGED_CELLS = 4; // about one short word at 1080p; a smaller change may be only the cursor
const RESTLESS_RATE = 0.15; // a cell changing this often is a webcam inset or similar, not content
const RESTLESS_MARGIN = 3; // cells around the restless box, since a moving head reaches past its usual spot
const MAX_RESTLESS_SHARE = 0.25; // a larger box means the picture itself is moving, so nothing is ignored

/** The bounding box of always-moving cells. One box keeps the rule simple; when it grows too big, more frames survive. */
function restlessCells(grids) {
  const { width, height } = GRID;
  const size = width * height;
  const counts = new Uint32Array(size);
  for (let i = 1; i < grids.length; i += 1) {
    for (let c = 0; c < size; c += 1) if (Math.abs(grids[i][c] - grids[i - 1][c]) >= CELL_DELTA) counts[c] += 1;
  }
  let [left, right, top, bottom] = [width, -1, height, -1];
  for (let c = 0; c < size; c += 1) {
    if (counts[c] / (grids.length - 1) <= RESTLESS_RATE) continue;
    const [x, y] = [c % width, Math.floor(c / width)];
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const restless = new Set();
  if (right < 0) return restless;
  left = Math.max(0, left - RESTLESS_MARGIN);
  right = Math.min(width - 1, right + RESTLESS_MARGIN);
  top = Math.max(0, top - RESTLESS_MARGIN);
  bottom = Math.min(height - 1, bottom + RESTLESS_MARGIN);
  if ((right - left + 1) * (bottom - top + 1) > size * MAX_RESTLESS_SHARE) return restless;
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) restless.add(y * width + x);
  return restless;
}

/**
 * Picks the frames that differ from the last kept one, ignoring regions that never stop moving.
 * Whole-frame filters like mpdecimate keep everything when a webcam inset is on screen.
 */
export function selectDistinctFrames(grids) {
  if (grids.length < 2) return new Set(grids.keys());
  const restless = restlessCells(grids);
  const kept = new Set([0]);
  let last = grids[0];
  for (let i = 1; i < grids.length; i += 1) {
    let changed = 0;
    for (let c = 0; c < last.length; c += 1) {
      if (!restless.has(c) && Math.abs(grids[i][c] - last[c]) >= CELL_DELTA) changed += 1;
    }
    if (changed >= MIN_CHANGED_CELLS) {
      kept.add(i);
      last = grids[i];
    }
  }
  return kept;
}

function distinctFrames(rawDir, count) {
  const everything = new Set(Array.from({ length: count }, (_, i) => i));
  const res = exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-framerate", "1", "-i", path.join(rawDir, "%05d.jpg"),
    "-vf", `scale=${GRID.width}:${GRID.height},format=gray`, "-f", "rawvideo", "-"], { encoding: "buffer" });
  const cells = GRID.width * GRID.height;
  if (!res.ok || res.stdout.length !== cells * count) return everything;
  return selectDistinctFrames(Array.from({ length: count }, (_, i) => res.stdout.subarray(i * cells, (i + 1) * cells)));
}

function buildSheets(framesDir, frames, media) {
  const landscape = media.width >= media.height;
  const [cols, rows] = landscape ? [4, 4] : [6, 3];
  const even = (n) => 2 * Math.round(n / 2);
  const [w, h] = landscape
    ? [480, even((480 * media.height) / media.width)]
    : [even((480 * media.width) / media.height), 480];
  const sheets = [];
  for (let start = 0, n = 1; start < frames.length; start += cols * rows, n += 1) {
    const chunk = frames.slice(start, start + cols * rows);
    const id = `SHEET-${String(n).padStart(4, "0")}`;
    const list = path.join(framesDir, `${id}.list`);
    fs.writeFileSync(list, chunk.map((f) => `file '${f.id}.jpg'\nduration 1\n`).join(""), "utf8");
    const out = path.join(framesDir, `${id}.jpg`);
    const res = ffmpeg(["-y", "-f", "concat", "-i", list, "-vf", `scale=${w}:${h},tile=${cols}x${rows}:padding=4:color=white`, "-frames:v", "1", "-q:v", "3", "-update", "1", out]);
    fs.rmSync(list, { force: true });
    if (!res.ok || !fs.existsSync(out)) throw new Error(`拼图生成失败：${res.stderr.trim().slice(-300)}`);
    sheets.push({
      id,
      path: `frames/${id}.jpg`,
      columns: cols,
      rows,
      frames: chunk.map((f, i) => ({ cell: `r${Math.floor(i / cols) + 1}c${(i % cols) + 1}`, frame_id: f.id, t: f.t })),
    });
    for (const f of chunk) f.sheet = id;
  }
  return sheets;
}

export async function extractFrames(runDir, run, media, { maxInterval, sceneThreshold, dedup = true } = {}) {
  const interval = Number(maxInterval) || maxIntervalFor(media.duration);
  const cuts = detectCuts(run.source, Number(sceneThreshold) || 10);
  const plan = planFrames({ duration: media.duration, cuts, maxInterval: interval });
  const framesDir = path.join(runDir, "frames");
  fs.rmSync(framesDir, { recursive: true, force: true });
  const rawDir = path.join(framesDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });

  const extracted = await extractAll(run.source, plan, rawDir);
  const candidates = plan.filter((_, i) => extracted[i]);
  if (!candidates.length) throw new Error("一帧都没有抽出来");
  plan.forEach((_, i) => {
    if (extracted[i]) fs.renameSync(path.join(rawDir, `c${i}.jpg`), path.join(rawDir, `${String(candidates.findIndex((c) => c === plan[i])).padStart(5, "0")}.jpg`));
  });

  const keep = dedup ? distinctFrames(rawDir, candidates.length) : new Set(candidates.keys());
  const frames = [];
  candidates.forEach((candidate, index) => {
    if (!keep.has(index)) return;
    const id = `FRAME-${String(frames.length + 1).padStart(4, "0")}`;
    fs.renameSync(path.join(rawDir, `${String(index).padStart(5, "0")}.jpg`), path.join(framesDir, `${id}.jpg`));
    frames.push({ id, t: candidate.t, path: `frames/${id}.jpg`, reason: candidate.reason, review: "none" });
  });
  fs.rmSync(rawDir, { recursive: true, force: true });

  const sheets = buildSheets(framesDir, frames, media);
  return {
    config: { max_interval: interval, scene_threshold: Number(sceneThreshold) || 10, dedup: dedup ? "grid" : "off" },
    cuts: cuts.length,
    candidate_times: candidates.map((c) => c.t),
    frames,
    sheets,
  };
}

/** Re-encodes a frame that exceeds Craft's upload limit. */
export function shrinkImage(input, output) {
  return ffmpeg(["-y", "-i", input, "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease", "-q:v", "6", "-update", "1", output]).ok;
}
