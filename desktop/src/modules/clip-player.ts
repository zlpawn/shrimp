function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clipPlayerRoot(): HTMLElement | null {
  return document.getElementById("clip-player-root");
}

function normalizeClipPlayback(input: {
  video_id?: string;
  start_seconds?: number;
  end_seconds?: number;
  title?: string;
  quote?: string;
  source_url?: string;
}) {
  const videoId = String(input.video_id || "").trim();
  const start = Number(input.start_seconds);
  const end = Number(input.end_seconds);
  if (!videoId) return { ok: false as const, error: "video_id is required" };
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ok: false as const, error: "end_seconds must be greater than start_seconds" };
  }
  return {
    ok: true as const,
    video_id: videoId,
    start_seconds: start,
    end_seconds: end,
    src: `/v1/video-kb/assets/${encodeURIComponent(videoId)}/video`,
    title: String(input.title || "").trim(),
    quote: String(input.quote || "").trim(),
    source_url: String(input.source_url || "").trim(),
  };
}

function fmtTime(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.floor(Math.max(0, seconds) % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function clipPlayerClose(): void {
  const root = clipPlayerRoot();
  if (!root) return;
  root.innerHTML = "";
}

export function clipPlayerOpen(input: {
  video_id: string;
  start_seconds: number;
  end_seconds: number;
  title?: string;
  quote?: string;
  source_url?: string;
}): void {
  const root = clipPlayerRoot();
  if (!root) return;
  const clip = normalizeClipPlayback(input);
  if (!clip.ok) return;
  const fallback = clip.source_url
    ? `<a class="clip-player-fallback" href="${escapeHtml(clip.source_url)}" target="_blank" rel="noreferrer">打开原链接</a>`
    : "";
  root.innerHTML = `
    <div class="clip-player-bar">
      <div class="clip-player-meta">
        <div class="clip-player-title">${escapeHtml(clip.title || "视频片段")}</div>
        <div class="clip-player-range">${fmtTime(clip.start_seconds)} – ${fmtTime(clip.end_seconds)}</div>
        ${clip.quote ? `<div class="clip-player-quote">${escapeHtml(clip.quote)}</div>` : ""}
        <div class="clip-player-status" id="clip-player-status"></div>
        ${fallback}
      </div>
      <video class="clip-player-video" controls preload="metadata" src="${clip.src}"></video>
      <button class="clip-player-close" type="button" onclick="window.clipPlayerClose()">关闭</button>
    </div>
  `;
  const video = root.querySelector("video");
  const status = root.querySelector("#clip-player-status");
  if (!video) return;
  video.addEventListener("loadedmetadata", () => {
    video.currentTime = clip.start_seconds;
    video.play().catch(() => {});
  });
  video.addEventListener("timeupdate", () => {
    if (video.currentTime >= clip.end_seconds) video.pause();
  });
  video.addEventListener("error", () => {
    if (status) status.textContent = "本地视频缺失";
  });
}

(window as any).clipPlayerOpen = clipPlayerOpen;
(window as any).clipPlayerClose = clipPlayerClose;
