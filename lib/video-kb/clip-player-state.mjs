export function normalizeClipPlayback(input = {}) {
  const videoId = String(input.video_id || "").trim();
  const start = Number(input.start_seconds);
  const end = Number(input.end_seconds);
  if (!videoId) return { ok: false, error: "video_id is required" };
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ok: false, error: "end_seconds must be greater than start_seconds" };
  }
  return {
    ok: true,
    video_id: videoId,
    start_seconds: start,
    end_seconds: end,
    duration: end - start,
    src: `/v1/video-kb/assets/${encodeURIComponent(videoId)}/video`,
    title: String(input.title || "").trim(),
    quote: String(input.quote || "").trim(),
    source_url: String(input.source_url || "").trim(),
  };
}
