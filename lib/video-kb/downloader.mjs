import { spawn, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * yt-dlp wrapper: download video audio + metadata, with cookie support.
 * Uses spawn for streaming progress, not execSync.
 */

/**
 * Detect if yt-dlp is installed and return its path + version.
 * @returns {{path: string, version: string} | null}
 */
export function detectYtDlp() {
  try {
    const version = execSync("yt-dlp --version", { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
    const whichCmd = process.platform === "win32" ? "where yt-dlp" : "which yt-dlp";
    const ytPath = execSync(whichCmd, { encoding: "utf8", timeout: 5000, windowsHide: true }).trim().split("\n")[0];
    return { path: ytPath, version };
  } catch {
    return null;
  }
}

/**
 * Check if uv is available (preferred installer).
 */
function detectUv() {
  try {
    execSync("uv --version", { encoding: "utf8", timeout: 3000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get install hint for yt-dlp based on platform and available tools.
 * @returns {{commands: string[], platform: string}}
 */
export function getYtDlpInstallHint() {
  const platform = process.platform;
  const commands = [];

  if (detectUv()) {
    commands.push("uv tool install yt-dlp");
  }

  // Python pip
  try {
    execSync("python3 --version", { encoding: "utf8", timeout: 3000, windowsHide: true });
    commands.push("pip install yt-dlp");
  } catch { /* no python */ }

  if (platform === "darwin") {
    commands.push("brew install yt-dlp");
  } else if (platform === "win32") {
    commands.push("scoop install yt-dlp");
    commands.push("winget install yt-dlp.yt-dlp");
  } else {
    commands.push("pipx install yt-dlp");
  }

  return { commands, platform };
}

/**
 * Check if ffmpeg is available (needed for audio extraction).
 */
export function detectFfmpeg() {
  try {
    execSync("ffmpeg -version", { encoding: "utf8", timeout: 3000, windowsHide: true });
    const whichCmd = process.platform === "win32" ? "where ffmpeg" : "which ffmpeg";
    const ffPath = execSync(whichCmd, { encoding: "utf8", timeout: 3000, windowsHide: true }).trim().split("\n")[0];
    return { path: ffPath };
  } catch {
    return null;
  }
}

/**
 * Generate a stable video ID from URL.
 */
export function videoIdFromUrl(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function resolveLocalPath(url) {
  if (!url || typeof url !== "string") return null;
  let candidate = url;
  if (candidate.startsWith("file:///")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      candidate = candidate.slice(8);
    }
  }
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

/**
 * Fetch video metadata without downloading.
 * @returns {Promise<{title, duration, uploader, url, extractor, thumbnail}>}
 */
export function fetchVideoInfo(url, { cookieFile } = {}) {
  const localPath = resolveLocalPath(url);
  if (localPath) {
    const ext = path.extname(localPath).toLowerCase();
    const title = path.basename(localPath, ext);
    let duration = 0;
    try {
      const probe = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${localPath}"`, { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
      duration = parseFloat(probe) || 0;
    } catch {}
    return Promise.resolve({
      title,
      duration,
      uploader: "local",
      url,
      extractor: "local_file",
      thumbnail: "",
      originalInfo: { title, duration, url },
    });
  }

  return new Promise((resolve, reject) => {
    const args = ["--no-playlist", "--dump-single-json", "--no-warnings"];
    if (cookieFile) args.push("--cookies", cookieFile);
    args.push(url);

    const proc = spawn("yt-dlp", args, { timeout: 30000, windowsHide: true });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });

    proc.on("error", (err) => {
      reject(new Error(`yt-dlp not found: ${err.message}. Install: ${getYtDlpInstallHint().commands[0]}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp info fetch failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title || "untitled",
          duration: info.duration || 0,
          uploader: info.uploader || info.channel || "",
          url: info.webpage_url || url,
          extractor: info.extractor || "",
          thumbnail: info.thumbnail || "",
          originalInfo: info,
        });
      } catch (err) {
        reject(new Error(`Failed to parse yt-dlp output: ${err.message}`));
      }
    });
  });
}

/**
 * Download video (audio track and/or full video).
 *
 * @param {string} url - Video URL
 * @param {{cookieFile?: string, outputDir: string, audioOnly?: boolean, signal?: AbortSignal, onProgress?: Function}} opts
 * @returns {Promise<{audioPath: string, videoPath: string|null, infoPath: string, info: object}>}
 */
export function downloadVideo(url, { cookieFile, outputDir, audioOnly = false, signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const localPath = resolveLocalPath(url);
    if (localPath) {
      const ext = path.extname(localPath).toLowerCase();
      const isAudio = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"].includes(ext);
      const videoId = videoIdFromUrl(url);
      const infoPath = path.join(outputDir, "info.json");
      const info = {
        title: path.basename(localPath, ext),
        duration: 0,
        url,
        extractor: "local_file",
      };
      try {
        fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), "utf8");
      } catch {}

      if (audioOnly) {
        if (isAudio) {
          return resolve({
            audioPath: localPath,
            videoPath: null,
            infoPath,
            info,
          });
        } else {
          // Extract WAV for Whisper transcription
          const audioOut = path.join(outputDir, `${videoId}.wav`);
          try {
            execSync(`ffmpeg -y -i "${localPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioOut}"`, { windowsHide: true, timeout: 120000 });
            return resolve({
              audioPath: audioOut,
              videoPath: localPath,
              infoPath,
              info,
            });
          } catch {
            return resolve({
              audioPath: localPath,
              videoPath: localPath,
              infoPath,
              info,
            });
          }
        }
      } else {
        const audioOut = path.join(outputDir, `${videoId}.wav`);
        if (!isAudio && !fs.existsSync(audioOut)) {
          try {
            execSync(`ffmpeg -y -i "${localPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioOut}"`, { windowsHide: true, timeout: 120000 });
          } catch {}
        }
        return resolve({
          audioPath: isAudio ? localPath : (fs.existsSync(audioOut) ? audioOut : localPath),
          videoPath: isAudio ? null : localPath,
          infoPath,
          info,
        });
      }
    }

    const videoId = videoIdFromUrl(url);
    const template = path.join(outputDir, `${videoId}.%(ext)s`);

    const args = ["--no-playlist", "--newline", "--no-warnings", "--write-info-json"];
    if (cookieFile) args.push("--cookies", cookieFile);

    if (audioOnly) {
      args.push("-f", "bestaudio", "--extract-audio", "--audio-format", "wav", "--audio-quality", "0");
    } else {
      args.push("-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4");
    }
    args.push("-o", template, url);

    const proc = spawn("yt-dlp", args, { timeout: 0, windowsHide: true });
    let stderr = "";
    let lastPercent = 0;

    proc.stderr.on("data", (d) => {
      stderr += d;
      const text = d.toString();
      // Parse progress: [download] xx.x% of ...
      const match = text.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        lastPercent = parseFloat(match[1]);
        if (onProgress) onProgress(lastPercent / 100, `downloading ${lastPercent.toFixed(1)}%`);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`yt-dlp failed to start: ${err.message}`));
    });

    const abortHandler = () => {
      try { proc.kill("SIGTERM"); } catch { /* ignore */ }
    };
    if (signal) {
      if (signal.aborted) { proc.kill("SIGTERM"); }
      else { signal.addEventListener("abort", abortHandler, { once: true }); }
    }

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", abortHandler);

      if (signal?.aborted) {
        reject(new Error("Download cancelled."));
        return;
      }
      if (code !== 0) {
        reject(new Error(`yt-dlp download failed (exit ${code}): ${stderr.trim()}`));
        return;
      }

      // Find the downloaded files
      const infoPath = path.join(outputDir, `${videoId}.info.json`);
      let audioPath = null;
      let videoPath = null;

      if (audioOnly) {
        audioPath = findFile(outputDir, videoId, [".wav", ".m4a", ".mp3", ".opus", ".webm"]);
      } else {
        videoPath = findFile(outputDir, videoId, [".mp4", ".webm", ".mkv"]);
      }

      let info = {};
      if (fs.existsSync(infoPath)) {
        try { info = JSON.parse(fs.readFileSync(infoPath, "utf8")); } catch { /* ignore */ }
      }

      resolve({ audioPath, videoPath, infoPath, info });
    });
  });
}

function findFile(dir, prefix, extensions) {
  for (const ext of extensions) {
    const candidate = path.join(dir, `${prefix}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallback: scan directory for files starting with prefix
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(prefix) && !entry.endsWith(".info.json") && !entry.endsWith(".partial")) {
        return path.join(dir, entry);
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function formatSecondsToTimestamp(seconds) {
  if (seconds == null || isNaN(seconds)) return "00:00";
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function buildFfmpegExtractArgs(videoPath, outputPattern, {
  strategy = "scene",
  interval = 5,
  sceneThreshold = 0.35,
  maxFrames = 30,
  scale = "-1:720",
} = {}) {
  const args = ["-y", "-i", videoPath];
  if (strategy === "interval") {
    const fpsVal = interval > 0 ? (1 / interval).toFixed(4) : "0.2";
    args.push("-vf", `fps=${fpsVal},scale=${scale}`);
  } else {
    // scene change detection
    args.push("-vf", `select='gt(scene,${sceneThreshold})',scale=${scale}`, "-vsync", "vfr");
  }
  if (maxFrames && maxFrames > 0) {
    args.push("-vframes", String(maxFrames));
  }
  args.push("-q:v", "2", outputPattern);
  return args;
}

/**
 * Extract candidate frames from video using ffmpeg with scene detection or fixed interval.
 *
 * @param {string} videoPath - Absolute path to video file
 * @param {string} outputDir - Directory to store extracted frames
 * @param {object} [options]
 * @param {"scene"|"interval"|"none"} [options.strategy="scene"]
 * @param {number} [options.interval=5]
 * @param {number} [options.sceneThreshold=0.35]
 * @param {number} [options.maxFrames=30]
 * @param {string} [options.scale="-1:720"]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onProgress]
 * @returns {Promise<Array<{frameId: string, filename: string, path: string, timestampSeconds: number, timestampFormatted: string}>>}
 */
export function extractVideoFrames(videoPath, outputDir, {
  strategy = "scene",
  interval = 5,
  sceneThreshold = 0.35,
  maxFrames = 30,
  scale = "-1:720",
  signal = null,
  onProgress = null,
} = {}) {
  return new Promise((resolve, reject) => {
    if (strategy === "none") {
      return resolve([]);
    }

    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`Video file not found: ${videoPath}`));
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const ffmpegCheck = detectFfmpeg();
    if (!ffmpegCheck) {
      return reject(new Error("ffmpeg not found in system PATH. Required for video frame extraction."));
    }

    const outputPattern = path.join(outputDir, "frame_%04d.jpg");
    const args = buildFfmpegExtractArgs(videoPath, outputPattern, {
      strategy,
      interval,
      sceneThreshold,
      maxFrames,
      scale,
    });

    const proc = spawn("ffmpeg", args, { timeout: 0, windowsHide: true });
    let stderr = "";

    proc.stderr.on("data", (d) => {
      stderr += d;
      const text = d.toString();
      const match = text.match(/frame=\s*(\d+)/);
      if (match && onProgress) {
        const frameNum = parseInt(match[1], 10);
        const percent = maxFrames > 0 ? Math.min(1, frameNum / maxFrames) : 0.5;
        onProgress(percent, `已提取 ${frameNum} 帧`);
      }
    });

    const abortHandler = () => {
      try { proc.kill("SIGTERM"); } catch { /* ignore */ }
    };
    if (signal) {
      if (signal.aborted) proc.kill("SIGTERM");
      else signal.addEventListener("abort", abortHandler, { once: true });
    }

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg frame extraction failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", abortHandler);
      if (signal?.aborted) {
        return reject(new Error("Frame extraction cancelled."));
      }
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
      }

      // Scan extracted frames
      const files = fs.readdirSync(outputDir)
        .filter((f) => /^frame_\d+\.jpg$/i.test(f))
        .sort();

      const frames = files.map((file, idx) => {
        const fullPath = path.join(outputDir, file);
        let timestampSec = 0;
        if (strategy === "interval") {
          timestampSec = idx * interval;
        } else {
          // For scene detection, approximate based on step or default spacing
          timestampSec = idx * Math.max(1, interval || 5);
        }
        return {
          frameId: `FRAME-${String(idx + 1).padStart(4, "0")}`,
          filename: file,
          path: fullPath,
          timestampSeconds: timestampSec,
          timestampFormatted: formatSecondsToTimestamp(timestampSec),
        };
      });

      // Save metadata manifest
      try {
        fs.writeFileSync(path.join(outputDir, "frames.json"), JSON.stringify(frames, null, 2), "utf8");
      } catch { /* ignore */ }

      resolve(frames);
    });
  });
}
