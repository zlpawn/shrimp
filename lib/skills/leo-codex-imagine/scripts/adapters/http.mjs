import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Download remote image URL and write to local destination file
 */
export async function downloadImageToFile(url, destPath) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
      return;
    }
    console.warn(`[leo-codex-imagine] fetch 下载图片返回 HTTP ${res.status}，切换 curl 尝试...`);
  } catch (fetchErr) {
    console.warn(`[leo-codex-imagine] fetch 下载图片失败 (${fetchErr.message})，正自动切换系统 curl 下载...`);
  }

  execFileSync("curl", ["-sSL", "-m", "120", "-o", destPath, url], { windowsHide: true });
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
    throw new Error(`下载图片失败，文件未生成或为空: ${destPath}`);
  }
}

/**
 * High-Availability JSON request (POST/GET) with native fetch & curl fallback
 */
export async function requestJsonWithCurlFallback(url, { method = "POST", headers = {}, body } = {}, timeoutMs = 180000) {
  const bodyStr = body === undefined ? undefined : JSON.stringify(body);

  // 1. Try native fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    if (!res.ok) {
      const errMsg = json?.error?.message || json?.error || text.slice(0, 300);
      throw new Error(`HTTP ${res.status}: ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)}`);
    }

    if (json) return json;
    throw new Error(`响应非有效 JSON: ${text.slice(0, 200)}`);
  } catch (fetchErr) {
    if (fetchErr.message && (fetchErr.message.startsWith("HTTP ") || fetchErr.message.startsWith("响应非有效"))) {
      throw fetchErr;
    }
    console.warn(`[leo-codex-imagine] Node.js fetch 遇到网络限制 (${fetchErr.message})，正自动切换系统 curl 直连通道...`);
  }

  // 2. Fallback to system curl
  // Headers (incl. Authorization) go through a 0600 file and argv skips the shell,
  // so the API key never shows up in `ps` output or in the "Command failed: ..." error text.
  const stamp = `${Date.now()}_${process.pid}`;
  const tempPayload = path.join(os.tmpdir(), `codex_req_${stamp}.json`);
  const tempHeaders = path.join(os.tmpdir(), `codex_hdr_${stamp}.txt`);
  try {
    fs.writeFileSync(tempHeaders, Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n"), { mode: 0o600 });
    const curlArgs = ["-sSL", "--connect-timeout", "20", "-m", String(Math.ceil(timeoutMs / 1000)), "-X", method, url, "-H", `@${tempHeaders}`];
    if (bodyStr !== undefined) {
      fs.writeFileSync(tempPayload, bodyStr, "utf8");
      curlArgs.push("-d", `@${tempPayload}`);
    }

    const out = execFileSync("curl", curlArgs, { encoding: "utf8", windowsHide: true, maxBuffer: 50 * 1024 * 1024 });

    const json = JSON.parse(out);
    if (json.error) {
      throw new Error(json.error.message || JSON.stringify(json.error));
    }
    return json;
  } catch (curlErr) {
    throw new Error(`请求失败 (curl): ${curlErr.message}`);
  } finally {
    for (const f of [tempPayload, tempHeaders]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  }
}

/**
 * Detect image MIME type
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/**
 * Reference image -> string usable by image APIs: http(s) URL passes through, local file becomes a data URI
 */
export function toImageRef(imgPath) {
  if (/^(https?:|data:)/i.test(imgPath)) return imgPath;
  const resolved = path.resolve(imgPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`参考图片未找到: ${resolved}`);
  }
  return `data:${getMimeType(resolved)};base64,${fs.readFileSync(resolved).toString("base64")}`;
}
