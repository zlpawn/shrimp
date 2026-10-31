import { requestJsonWithCurlFallback } from "./http.mjs";

export const OPENAI_API_IMAGE_URL = "https://api.openai.com/v1/images/generations";

/**
 * Generic OpenAI Images protocol adapter (OpenAI official, OneAPI / NewAPI style relays).
 * - text-to-image: POST /v1/images/generations (JSON)
 * - reference images: POST /v1/images/edits (multipart, image[] files)
 * - the standard only accepts pixel sizes, so --aspect-ratio is mapped to the nearest legal size
 */
export function ratioToOpenAISize(ratio, model = "") {
  const [w, h] = String(ratio).split(":").map(Number);
  if (!w || !h) return null;
  const dalle3 = model.startsWith("dall-e-3");
  if (w === h) return "1024x1024";
  if (w > h) return dalle3 ? "1792x1024" : "1536x1024";
  return dalle3 ? "1024x1792" : "1024x1536";
}

export function buildPayload(auth, args, imageRefs = []) {
  const ratio = args.aspectRatio && args.aspectRatio !== "auto" ? args.aspectRatio : null;
  const payload = {
    model: auth.model,
    prompt: args.prompt,
    n: 1,
    size: args.size || (ratio && ratioToOpenAISize(ratio, auth.model)) || "auto",
    quality: args.quality || "medium",
    response_format: "b64_json",
  };
  if (imageRefs.length > 0) payload.image = imageRefs;
  return payload;
}

async function refToBlob(ref) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(ref);
  if (match) return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
  const res = await fetch(ref);
  if (!res.ok) throw new Error(`下载参考图失败 HTTP ${res.status}: ${ref}`);
  return new Blob([await res.arrayBuffer()], { type: res.headers.get("content-type") || "image/png" });
}

// ponytail: edits uses native fetch only (no curl fallback for multipart); add one if restricted networks need it
async function postEdits(url, apiKey, payload) {
  const form = new FormData();
  for (const [k, v] of Object.entries(payload)) {
    if (k !== "image") form.append(k, String(v));
  }
  for (const [i, ref] of payload.image.entries()) {
    const blob = await refToBlob(ref);
    form.append("image[]", blob, `ref_${i}.${(blob.type.split("/")[1] || "png").replace("jpeg", "jpg")}`);
  }
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  if (!json) throw new Error(`响应非有效 JSON: ${text.slice(0, 200)}`);
  return json;
}

export async function generate(auth, payload) {
  const isEdit = Array.isArray(payload.image) && payload.image.length > 0;
  const url = isEdit ? auth.targetUrl.replace(/\/generations$/, "/edits") : auth.targetUrl;
  console.log(`[leo-codex-imagine] 正在调用 OpenAI 协议接口 (${auth.providerName} | ${url} | 模型: ${auth.model})...`);
  const json = isEdit
    ? await postEdits(url, auth.apiKey, payload)
    : await requestJsonWithCurlFallback(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.apiKey}` },
        body: payload,
      }, 180000);
  const first = json.data?.[0];
  if (first?.b64_json) return { b64: first.b64_json };
  if (first?.url) return { url: first.url };
  throw new Error(`响应中未包含有效的图像数据: ${JSON.stringify(json).slice(0, 300)}`);
}
