import fs from "node:fs";
import path from "node:path";
import { apiRequest, downloadFile } from "./http.mjs";

const POLL_INTERVAL_MS = 5000;
export const POLL_TIMEOUT_MS = 30 * 60 * 1000;
export const PENDING_STATUSES = new Set(["submitted", "pending", "queued", "processing", "in_progress", "running"]);

// submit returns {data:[{task_id}]} (documented) or {data:{id}} (unified task style)
export function extractTaskId(json) {
  const d = json?.data;
  const first = Array.isArray(d) ? d[0] : d;
  return first?.task_id || first?.id || json?.task_id || null;
}

// ponytail: always polls the unified /tasks/{id}; Kling V4 / Pixverse V6 Max also document
// GET /videos/generations/{id} — give operations their own query path if /tasks turns out not to serve them.
export function getTask(auth, taskId) {
  return apiRequest(auth, "GET", `/tasks/${encodeURIComponent(taskId)}?language=zh`).data;
}

export async function waitForTask(auth, taskId, { log = console.log } = {}) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const task = getTask(auth, taskId);
    const status = task?.status;
    if (status === "completed") return task;
    if (!PENDING_STATUSES.has(status)) {
      throw new Error(`任务 ${taskId} 状态 ${status}: ${task?.error?.message || JSON.stringify(task).slice(0, 300)}`);
    }
    const line = `${status} ${task.progress ?? 0}%`;
    if (line !== last) { log(`[leo-apimart-video] ${taskId}: ${line}`); last = line; }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`等待超时（${POLL_TIMEOUT_MS / 60000} 分钟）。稍后用 \`status ${taskId}\` 继续查询下载`);
}

function urlsOf(item) {
  if (typeof item === "string") return [item];
  const u = item?.url ?? item?.video_url ?? item?.image_url;
  return Array.isArray(u) ? u : u ? [u] : [];
}

/**
 * Normalise a completed task into {videos, images, text}.
 * - videos: result.videos[].url (string or array) — every generation model
 * - images: result.images[].url — e.g. last-frame outputs
 * - text:   result.prompt — MiniMax-H3-Context-IR returns an enhanced prompt, no video
 */
export function collectOutputs(task) {
  const r = task?.result || {};
  return {
    videos: (r.videos || []).flatMap(urlsOf),
    images: (r.images || []).flatMap(urlsOf),
    text: typeof r.prompt === "string" ? r.prompt : null,
  };
}

export function extFromUrl(url, fallback) {
  const ext = path.extname(new URL(url).pathname).toLowerCase().slice(1);
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
}

export function generateBaseName(seed, date = new Date()) {
  const slug = String(seed || "video").toLowerCase().trim()
    .replace(/[^\w一-龥]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 35).replace(/_+$/, "") || "video";
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `apimart_${slug}_${ts}`;
}

/** Plan local paths for every output; pure so it can be tested without downloads. */
export function planOutputFiles(outputs, { outputDir, filename, seed }) {
  const base = filename ? filename.replace(/\.[^.]+$/, "") : generateBaseName(seed);
  const name = (suffix, i, total, ext) => `${base}${suffix}${total > 1 ? `_${i + 1}` : ""}.${ext}`;
  const files = [
    ...outputs.videos.map((url, i, all) => ({ kind: "video", url, path: name("", i, all.length, extFromUrl(url, "mp4")) })),
    ...outputs.images.map((url, i, all) => ({ kind: "image", url, path: name("_image", i, all.length, extFromUrl(url, "png")) })),
    ...(outputs.text ? [{ kind: "text", text: outputs.text, path: `${base}.txt` }] : []),
  ];
  return files.map((f) => ({ ...f, path: path.join(outputDir, f.path) }));
}

export function saveOutputs(task, { outputDir = "./videos", filename, seed } = {}) {
  const outputs = collectOutputs(task);
  const dir = path.resolve(outputDir);
  const files = planOutputFiles(outputs, { outputDir: dir, filename, seed: seed || task?.id });
  if (files.length === 0) throw new Error(`任务已完成但没有可保存的结果: ${JSON.stringify(task).slice(0, 300)}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    if (f.kind === "text") fs.writeFileSync(f.path, f.text, "utf8");
    else downloadFile(f.url, f.path);
  }
  return { outputs, files };
}
