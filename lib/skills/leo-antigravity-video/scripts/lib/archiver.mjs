import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

export function sanitizeTitle(prompt = "gemini_video") {
  return prompt
    .trim()
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 30) || "gemini_video";
}

export function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${yyyy}${mm}${dd}_${hh}${min}${ss}`
  };
}

export function probeVideo(videoPath) {
  try {
    const raw = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,r_frame_rate,codec_name -show_entries format=duration,bit_rate -of json "${videoPath}"`,
      { encoding: "utf8", windowsHide: true }
    );
    const parsed = JSON.parse(raw);
    const stream = parsed.streams?.[0] || {};
    const format = parsed.format || {};

    let fps = 24;
    if (stream.r_frame_rate) {
      const parts = stream.r_frame_rate.split("/");
      if (parts.length === 2 && Number(parts[1]) > 0) {
        fps = Math.round(Number(parts[0]) / Number(parts[1]));
      }
    }

    const duration = Number(stream.duration || format.duration || 0);

    return {
      width: stream.width || null,
      height: stream.height || null,
      resolution: stream.width && stream.height ? `${stream.width}x${stream.height}` : null,
      codec: stream.codec_name || "h264",
      fps,
      duration: Number(duration.toFixed(2)),
      bitrate: format.bit_rate ? Math.round(Number(format.bit_rate) / 1000) + " kbps" : null
    };
  } catch (err) {
    return { error: err.message };
  }
}

export function extractCover(videoPath, outCoverPath, timestampSec = 2) {
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -ss 00:00:0${Math.max(1, timestampSec)} -vframes 1 "${outCoverPath}" 2>/dev/null`,
      { windowsHide: true }
    );
    return fs.existsSync(outCoverPath);
  } catch {
    // 降级截取第 0.5 秒
    try {
      execSync(
        `ffmpeg -y -i "${videoPath}" -ss 00:00:00.5 -vframes 1 "${outCoverPath}" 2>/dev/null`,
        { windowsHide: true }
      );
      return fs.existsSync(outCoverPath);
    } catch {
      return false;
    }
  }
}

export async function archiveVideo({
  sourceVideoPath,
  prompt,
  ratio = "16:9",
  format = "mp4",
  baseOutputDir,
  extra = {}
}) {
  if (!fs.existsSync(sourceVideoPath)) {
    throw new Error(`源视频文件不存在: ${sourceVideoPath}`);
  }

  const { dateStr, timeStr } = formatDateTime();
  const safeTitle = sanitizeTitle(prompt);
  const ratioTag = (ratio || "16:9").replace(":", "x");
  const folderName = `${safeTitle}_${ratioTag}_${timeStr}`;

  const targetDir = path.join(baseOutputDir, dateStr, folderName);
  fs.mkdirSync(targetDir, { recursive: true });

  const ext = format === "gif" ? "gif" : "mp4";
  const targetVideoPath = path.join(targetDir, `video.${ext}`);
  fs.copyFileSync(sourceVideoPath, targetVideoPath);

  // 探测元数据
  const videoInfo = probeVideo(targetVideoPath);

  // 截取封面
  const targetCoverPath = path.join(targetDir, "cover.jpg");
  const hasCover = extractCover(targetVideoPath, targetCoverPath, 2);

  // 组装 metadata.json
  const metadata = {
    prompt,
    ratio,
    format,
    video_info: videoInfo,
    extra: {
      source_url: extra.sourceUrl || null,
      cdn_url: extra.cdnUrl || null,
      model: extra.model || "Gemini Omni / Veo",
      ...extra
    },
    files: {
      video: path.basename(targetVideoPath),
      cover: hasCover ? path.basename(targetCoverPath) : null
    },
    archived_at: new Date().toISOString()
  };

  const metadataPath = path.join(targetDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

  return {
    targetDir,
    videoPath: targetVideoPath,
    coverPath: hasCover ? targetCoverPath : null,
    metadataPath,
    metadata
  };
}
