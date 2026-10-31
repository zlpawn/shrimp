import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Local files -> temporary public URLs, for fields APIMart can't upload (video_urls, audio_urls, ...).
 * A child-process file server exposes ONLY the given files under a random token path, and a
 * Cloudflare quick tunnel (no account, no public IP) publishes it as https://<random>.trycloudflare.com.
 * Both live until close(): APIMart may fetch the inputs any time before the task completes.
 */

const TUNNEL_ATTEMPTS = 3;

export function isLocalFile(value) {
  if (typeof value !== "string" || /^(https?:|data:)/i.test(value)) return false;
  const p = path.resolve(value);
  return fs.existsSync(p) && fs.statSync(p).isFile();
}

// Replace every local-file string anywhere in the payload (arrays, nested objects like
// image_with_roles[].url). model / prompt are never treated as paths.
export function mapLocalFiles(payload, fn) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return isLocalFile(v) ? fn(path.resolve(v)) : v;
  };
  const { model, prompt, ...rest } = payload;
  return { model, ...(prompt !== undefined && { prompt }), ...walk(rest) };
}

export function findLocalFiles(payload) {
  const files = new Set();
  mapLocalFiles(payload, (f) => { files.add(f); return f; });
  return [...files];
}

// ponytail: no Range support; a full 200 is still a valid answer to a Range request
const SERVER_SRC = `
const http = require("http"), fs = require("fs"), path = require("path");
const routes = JSON.parse(process.env.LEO_SHARE_ROUTES);
const types = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
http.createServer((req, res) => {
  const file = routes[req.url.split("?")[0]];
  if (!file || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": fs.statSync(file).size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}).listen(0, "127.0.0.1", function () { console.log(this.address().port); });
`;

function readFirstLine(stream) {
  return new Promise((resolve, reject) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      if (buf.includes("\n")) resolve(buf.split("\n")[0].trim());
    });
    stream.on("end", () => reject(new Error("本地文件服务启动失败")));
  });
}

// Resolve once the public URL is assigned AND an edge connection is registered (before that: error 1033).
function waitForTunnel(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let log = "";
    let url = null;
    const timer = setTimeout(() => reject(new Error(`cloudflared ${timeoutMs / 1000}s 内未就绪:\n${log.slice(-600)}`)), timeoutMs);
    child.stderr.on("data", (d) => {
      log += d;
      url ||= (log.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/) || [])[0];
      if (/failed to request quick Tunnel/.test(log)) { clearTimeout(timer); reject(new Error(`申请临时隧道失败:\n${log.slice(-400)}`)); }
      if (url && /Registered tunnel connection/.test(log)) { clearTimeout(timer); resolve(url); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`cloudflared 退出 (code ${code}):\n${log.slice(-400)}`)); });
  });
}

async function waitReachable(url, attempts = 15) {
  for (let i = 0; i < attempts; i++) {
    try {
      execFileSync("curl", ["-sSfI", "-m", "10", "-o", "/dev/null", url], { stdio: "ignore" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`隧道已建立但公网访问不到: ${url}`);
}

export async function startShare(files, { log = console.log, timeoutMs = 90000 } = {}) {
  if (spawnSync("cloudflared", ["--version"]).error) {
    throw new Error("本地视频/音频需要 cloudflared 生成临时公网链接，请先安装: brew install cloudflared（其他系统见 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/）");
  }
  const token = randomBytes(16).toString("hex");
  const routes = {};
  const routeOf = new Map();
  files.forEach((f, i) => {
    const route = `/${token}/${i}${path.extname(f).toLowerCase()}`;
    routes[route] = f;
    routeOf.set(f, route);
  });

  const server = spawn(process.execPath, ["-e", SERVER_SRC], {
    env: { ...process.env, LEO_SHARE_ROUTES: JSON.stringify(routes) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let tunnel = null;
  const close = () => {
    tunnel?.kill();
    server.kill();
  };
  const onSignal = () => { close(); process.exit(130); };
  process.once("exit", close);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const port = await readFirstLine(server.stdout);
    log(`[leo-apimart-video] 为 ${files.length} 个本地文件启动临时隧道（cloudflared）...`);
    // api.trycloudflare.com intermittently misses cloudflared's 15s timeout (~1 in 3 here), so retry
    let base = null;
    for (let attempt = 1; !base; attempt++) {
      tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      try {
        base = await waitForTunnel(tunnel, timeoutMs);
      } catch (err) {
        tunnel.kill();
        if (attempt >= TUNNEL_ATTEMPTS) throw err;
        log(`[leo-apimart-video] 临时隧道第 ${attempt} 次申请失败，重试...`);
      }
    }
    tunnel.stderr.resume(); // keep draining, or cloudflared blocks on a full pipe
    const urls = new Map([...routeOf].map(([f, route]) => [f, `${base}${route}`]));
    await waitReachable(urls.values().next().value);
    log(`[leo-apimart-video] 临时隧道就绪: ${base}（任务结束后自动关闭）`);
    return { urls, close };
  } catch (err) {
    close();
    throw err;
  }
}
