import {
  DEFAULT_OFM_PORT,
  getStatus,
  start,
  stop,
  ensureReady,
  beginChannelLogin,
  pollChannelLogin,
  deleteChannelAccount,
  testChannelAccount,
  claimChannelCredits,
  setAutoCheckin,
  toggleChannelProvider,
  fetchOfmAccountsSummary,
  checkOfmUpdate,
  updateOfmCoreFromGithub,
  isPidAlive,
  readPid,
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

export async function routeOfmRequest(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    const queryPort = url.searchParams.get("port")
      ? Number.parseInt(url.searchParams.get("port"), 10)
      : undefined;

    if (req.method === "GET" && pathname === "/v1/ofm/status") {
      const status = await getStatus({ port: queryPort });
      return sendJson(res, 200, { success: true, ...status });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/start") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const result = await start({ port });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/stop") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const result = await stop({ port });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/ensure") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const result = await ensureReady({ port });
      const status = await getStatus({ port: result.port || port });
      return sendJson(res, 200, { success: true, ...result, status });
    }

    if (req.method === "GET" && pathname === "/v1/ofm/accounts") {
      await ensureReady({ port: queryPort });
      const summary = await fetchOfmAccountsSummary({ port: queryPort });
      return sendJson(res, 200, { success: true, ...summary });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/login") {
      const body = await readJson(req);
      const port = body.port || queryPort;
      const result = await beginChannelLogin({
        provider: body.provider,
        zcodeProvider: body.zcodeProvider,
        openBrowser: body.openBrowser !== false,
        port,
      });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "GET" && pathname === "/v1/ofm/login/status") {
      const accountId = url.searchParams.get("accountId") || url.searchParams.get("account_id") || "";
      const result = await pollChannelLogin({ accountId, port: queryPort });
      return sendJson(res, 200, { success: true, ...result });
    }

    if ((req.method === "POST" || req.method === "DELETE") && pathname === "/v1/ofm/account/delete") {
      const body = await readJson(req);
      const accountId = body.accountId || body.account_id || url.searchParams.get("accountId") || "";
      const result = await deleteChannelAccount({ accountId, port: body.port || queryPort });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/account/test") {
      const body = await readJson(req);
      const accountId = body.accountId || body.account_id || "";
      const result = await testChannelAccount({ accountId, port: body.port || queryPort });
      return sendJson(res, 200, { success: true, result });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/provider/toggle") {
      const body = await readJson(req);
      const result = await toggleChannelProvider({
        provider: body.provider,
        enabled: body.enabled,
        port: body.port || queryPort,
      });
      return sendJson(res, 200, { success: true, result });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/credits/claim") {
      const body = await readJson(req);
      await ensureReady({ port: body.port || queryPort });
      const result = await claimChannelCredits({
        provider: body.provider || "",
        port: body.port || queryPort,
      });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/auto-checkin") {
      const body = await readJson(req);
      await ensureReady({ port: body.port || queryPort });
      const result = await setAutoCheckin({
        enabled: body.enabled,
        port: body.port || queryPort,
      });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "GET" && pathname === "/v1/ofm/update/check") {
      const result = await checkOfmUpdate();
      return sendJson(res, 200, { success: true, ...result });
    }

    if (req.method === "POST" && pathname === "/v1/ofm/update/apply") {
      const body = await readJson(req);
      const port = body.port || queryPort || DEFAULT_OFM_PORT;
      const result = await updateOfmCoreFromGithub({
        onRestartIfRunning: async () => {
          const pid = readPid(null, port);
          if (pid && isPidAlive(pid)) {
            await stop({ port });
            await start({ port });
            return true;
          }
          return false;
        },
      });
      return sendJson(res, 200, { success: true, ...result });
    }

    return sendJson(res, 404, {
      success: false,
      error: { message: `Not found: ${req.method} ${pathname}`, code: "not_found" },
    });
  } catch (err) {
    return sendJson(res, 500, {
      success: false,
      error: {
        message: err.message || String(err),
        code: err.code || "ofm_error",
      },
    });
  }
}
