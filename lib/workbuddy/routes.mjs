import {
  getStatus,
  install,
  uninstall,
  start,
  stop,
  login,
  ensureReady,
  cleanupLegacyUvTool,
  listLocalAuthAccounts,
  deleteLocalAuthAccount,
  readWorkbuddyConfig,
  updateWorkbuddyConfig,
} from "./supervisor.mjs";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export async function routeWorkbuddyRequest(req, res, context, reqPath) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    const queryPort = url.searchParams.get("port")
      ? Number.parseInt(url.searchParams.get("port"), 10)
      : undefined;
    const querySessionFile = url.searchParams.get("session_file") || undefined;

    if (req.method === "GET" && pathname === "/v1/workbuddy/status") {
      const status = await getStatus({
        port: queryPort,
        sessionFile: querySessionFile,
      });
      return sendJson(res, 200, { success: true, ...status });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/install") {
      const result = await install();
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/uninstall") {
      const result = await uninstall();
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/start") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const sessionFile = body.session_file || body.sessionFile || querySessionFile;
      const result = await start({ ...body, port, sessionFile });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/stop") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const pidFile = body.pid_file || body.pidFile;
      const result = await stop({ port, pidFile });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/ensure") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const sessionFile = body.session_file || body.sessionFile || querySessionFile;
      const result = await ensureReady({ ...body, port, sessionFile });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/cleanup-uv") {
      const result = await cleanupLegacyUvTool();
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "GET" && pathname === "/v1/workbuddy/accounts") {
      const accounts = listLocalAuthAccounts();
      return sendJson(res, 200, { success: true, accounts });
    }

    if ((req.method === "POST" || req.method === "DELETE") && pathname === "/v1/workbuddy/account/delete") {
      const body = await readJson(req);
      const uid = body.uid || url.searchParams.get("uid");
      const result = deleteLocalAuthAccount(uid);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "GET" && pathname === "/v1/workbuddy/config") {
      const config = readWorkbuddyConfig();
      return sendJson(res, 200, { success: true, config });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/config") {
      const body = await readJson(req);
      const config = updateWorkbuddyConfig(body);
      return sendJson(res, 200, { success: true, config });
    }

    if (req.method === "POST" && pathname === "/v1/workbuddy/login") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const sessionFile = body.session_file || body.sessionFile || querySessionFile;
      const result = await login({ ...body, port, sessionFile });
      return sendJson(res, 200, {
        success: true,
        ...result,
      });
    }

    return sendJson(res, 404, { success: false, error: "Not found", path: reqPath });
  } catch (err) {
    return sendJson(res, 500, {
      success: false,
      error: err.message,
      code: err.code || "workbuddy_error",
      detail: err.detail || null,
    });
  }
}
