// 通过 Chrome 上的 Leo cookie.txt Locally 扩展读取 leetcode.com 的 cookie。
// 扩展协议（extensions/leo-cookie-txt-locally/background.js）：扩展轮询 127.0.0.1:19527 的
// GET /ext/poll 领取任务 {id, type, params}，执行后 POST /ext/result 回传 {id, ok, result}。
import http from "node:http";

export const BRIDGE_PORT = 19527;
const DOMAIN = "leetcode.com";

export class CookieError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 端口上已有 lantern 或网关的桥接服务时，让它转发任务；端口上没有桥接服务时返回 null
async function askExistingBridge(port, timeoutMs) {
  let health;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    health = await res.json();
  } catch {
    return null;
  }
  if (!health?.ok) return null;
  const res = await fetch(`http://127.0.0.1:${port}/cmd`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "cookies.export", params: { domain: DOMAIN }, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5000),
  });
  const body = await res.json();
  if (!body.ok) {
    throw new CookieError("extension_unavailable", body.error?.message || "桥接服务没能读取 cookie，请打开 Chrome 并确认扩展已启用");
  }
  return body.result?.cookies || [];
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// connection: close 让每个连接响应完就断开，server.close() 才能很快完成
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify(body));
}

// 临时扮演桥接服务：只派发一个 cookies.export 任务，拿到结果或超时后立即关闭端口
export function serveOnce(port, timeoutMs) {
  const cmd = { id: `lc_${Date.now()}`, type: "cookies.export", params: { domain: DOMAIN }, createdAt: Date.now() };
  let delivered = false;
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && pathname === "/health") {
        return send(res, 200, { ok: true, bridge: true, service: "leo-lc-transcoder-cookie" });
      }
      if (pathname === "/ext/hello" || pathname === "/ext/heartbeat") return send(res, 200, { ok: true });
      if (pathname === "/ext/poll" || pathname === "/v1/extension-tasks/claim") {
        const out = delivered ? null : cmd;
        delivered = true;
        return send(res, 200, { ok: true, cmd: out, tasks: out ? [out] : [] });
      }
      if (req.method === "POST" && (pathname === "/ext/result" || pathname.startsWith("/v1/extension-tasks/"))) {
        const body = await readBody(req);
        send(res, 200, { ok: true });
        const id = body.id || body.task_id || decodeURIComponent(pathname.split("/")[3] || "");
        if (id !== cmd.id) return;
        if (body.ok === false || body.error) {
          finish(new CookieError("extension_error", body.error?.message || "扩展读取 cookie 失败"));
        } else {
          finish(null, body.result?.cookies || body.cookies || []);
        }
        return;
      }
      send(res, 404, { ok: false });
    });

    const timer = setTimeout(
      () => finish(new CookieError("extension_timeout", `${Math.round(timeoutMs / 1000)} 秒内没有等到浏览器扩展，请打开 Chrome 并确认 Leo cookie.txt Locally 扩展已启用`)),
      timeoutMs,
    );

    // 等端口真正关闭后再返回结果，保证调用方拿到结果时进程里没有残留的监听
    function finish(err, cookies) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => (err ? reject(err) : resolve(cookies)));
      server.closeIdleConnections();
    }

    server.on("error", (err) => {
      finish(err.code === "EADDRINUSE" ? new CookieError("port_busy", `端口 ${port} 被其他程序占用，且它不是桥接服务`) : err);
    });
    server.listen(port, "127.0.0.1");
  });
}

export function pickSession(cookies) {
  const get = (name) => cookies.find((c) => c.name === name)?.value;
  const session = get("LEETCODE_SESSION");
  const csrftoken = get("csrftoken");
  if (!session || !csrftoken) {
    throw new CookieError("not_logged_in", "Chrome 里没有 leetcode.com 的登录态，请先在 Chrome 登录 leetcode.com");
  }
  return { LEETCODE_SESSION: session, csrftoken };
}

export async function login({
  port = Number(process.env.LC_BRIDGE_PORT) || BRIDGE_PORT,
  timeoutMs = Number(process.env.LC_LOGIN_TIMEOUT_MS) || 60000,
} = {}) {
  const cookies = (await askExistingBridge(port, timeoutMs)) ?? (await serveOnce(port, timeoutMs));
  return pickSession(cookies);
}
