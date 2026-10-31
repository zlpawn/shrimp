import { requestJsonWithCurlFallback } from "./http.mjs";

/**
 * APIMart (api.apimart.ai) adapter.
 * - `size` takes a ratio string ("16:9"); reference images go in `image_urls` (URL or data URI)
 * - quality / response_format are only sent when asked for: strict models (grok-imagine-2.0-ext) 400 on them
 * - submit returns a task id; the image comes from GET /v1/tasks/{id}
 * Docs: https://docs.apimart.ai/en/api-reference/tasks/status.md
 */
export function buildPayload(auth, args, imageRefs = []) {
  const ratio = args.aspectRatio && args.aspectRatio !== "auto" ? args.aspectRatio : null;
  const size = args.size && args.size !== "auto" ? args.size : ratio;
  const payload = { model: auth.model, prompt: args.prompt, n: 1 };
  if (size) payload.size = size;
  if (args.quality) payload.quality = args.quality;
  if (imageRefs.length > 0) payload.image_urls = imageRefs;
  return payload;
}

/**
 * Pull image data out of a sync response, an async submit response, or a finished task.
 * Returns { b64 } | { url } | { taskId, status, pollUrl, error } | null
 */
export function extractImageResult(json) {
  const d = json?.data;
  const first = Array.isArray(d) ? d[0] : d;
  if (first?.b64_json) return { b64: first.b64_json };
  const url = first?.url ?? first?.result?.images?.[0]?.url;
  if (url) return { url: Array.isArray(url) ? url[0] : url };
  const taskId = first?.task_id || first?.id || json?.task_id;
  if (taskId) {
    return { taskId, status: first?.status || json?.status, pollUrl: first?.poll_url, error: first?.error || json?.error };
  }
  return null;
}

/**
 * Task query URL: server-provided poll_url wins, otherwise <base>/v1/tasks/<id>
 */
export function resolveTaskUrl(targetUrl, taskId, pollUrl) {
  if (pollUrl) return new URL(pollUrl, new URL(targetUrl).origin).toString();
  return targetUrl.replace(/\/images\/generations$/, `/tasks/${encodeURIComponent(taskId)}`);
}

async function waitForTask(targetUrl, headers, ref, timeoutMs = 10 * 60 * 1000) {
  const taskUrl = resolveTaskUrl(targetUrl, ref.taskId, ref.pollUrl);
  console.log(`[leo-codex-imagine] 异步任务已提交 (${ref.taskId})，正在轮询结果...`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const json = await requestJsonWithCurlFallback(taskUrl, { method: "GET", headers: { Authorization: headers.Authorization } }, 30000);
    const result = extractImageResult(json);
    if (result?.b64 || result?.url) return result;
    if (["failed", "cancelled", "error"].includes(result?.status)) {
      const msg = result.error?.message || result.error || JSON.stringify(json).slice(0, 300);
      throw new Error(`生图任务失败 (${result.status}): ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
  }
  throw new Error(`生图任务轮询超时 (${ref.taskId})，可稍后手动查询: ${taskUrl}`);
}

export async function generate(auth, payload) {
  console.log(`[leo-codex-imagine] 正在调用 APIMart 接口 (${auth.providerName} | 模型: ${auth.model})...`);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${auth.apiKey}` };
  const json = await requestJsonWithCurlFallback(auth.targetUrl, { method: "POST", headers, body: payload }, 180000);
  const result = extractImageResult(json);
  if (result?.taskId) return waitForTask(auth.targetUrl, headers, result);
  if (result) return result;
  throw new Error(`响应中未包含有效的图像数据: ${JSON.stringify(json).slice(0, 300)}`);
}
