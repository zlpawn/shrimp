import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// All traffic goes through system curl: it honours https_proxy, Node's fetch does not.

function tmpFile(tag) {
  return path.join(os.tmpdir(), `apimart_${tag}_${process.pid}_${Math.random().toString(36).slice(2, 10)}`);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // 0 = no HTTP response (network / timeout)
  }
}

/**
 * JSON API call. Headers (incl. Authorization) go through a 0600 file so the key never
 * lands in argv, `ps` output or error text.
 */
export function apiRequest(auth, method, urlPath, { json, filePath, headers = {} } = {}) {
  const hdrFile = tmpFile("hdr");
  const bodyFile = tmpFile("body");
  const allHeaders = { Authorization: `Bearer ${auth.api_key}`, ...headers };
  const curlArgs = ["-sS", "--connect-timeout", "20", "-m", "180", "-X", method, `${auth.api_url}${urlPath}`,
    "-H", `@${hdrFile}`, "-w", "\n%{http_code}"];
  if (json !== undefined) {
    allHeaders["Content-Type"] = "application/json";
    fs.writeFileSync(bodyFile, JSON.stringify(json));
    curlArgs.push("--data-binary", `@${bodyFile}`);
  }
  if (filePath) curlArgs.push("-F", `file=@${filePath}`);
  fs.writeFileSync(hdrFile, Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`).join("\n"), { mode: 0o600 });

  let out;
  try {
    out = execFileSync("curl", curlArgs, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    throw new ApiError(`网络请求失败: ${String(err.stderr || err.message).trim().split("\n").pop()}`, 0);
  } finally {
    fs.rmSync(hdrFile, { force: true });
    fs.rmSync(bodyFile, { force: true });
  }

  const cut = out.lastIndexOf("\n");
  const status = Number(out.slice(cut + 1));
  const text = out.slice(0, cut);
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (status >= 400 || !data || data.error) {
    const msg = data?.error?.message || data?.message
      || (text.trimStart().startsWith("<") ? "非 JSON 响应（HTML 错误页）" : text.slice(0, 300));
    throw new ApiError(`HTTP ${status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, status);
  }
  return data;
}

// APIMart only has an image upload endpoint; video/audio references must already be public URLs.
export function uploadImage(auth, filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`参考图未找到: ${resolved}`);
  const json = apiRequest(auth, "POST", "/uploads/images", { filePath: resolved });
  const url = json.url || json.data?.url;
  if (!url) throw new Error(`上传响应中没有 url: ${JSON.stringify(json).slice(0, 300)}`);
  return url;
}

// Result links are pre-signed CDN URLs: download without the Authorization header.
export function downloadFile(url, dest) {
  execFileSync("curl", ["-sSL", "--fail", "-m", "900", "-o", dest, url]);
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error(`下载失败: ${url}`);
  return dest;
}
