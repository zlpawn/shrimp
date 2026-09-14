import http from "node:http";

export function voicestudioUrl(app, settings = {}) {
  const port = Number(settings?.port || app?.defaultPort || 3900);
  return {
    port,
    healthUrl: `http://127.0.0.1:${port}${app?.healthPath || "/health"}`,
    appUrl: `http://127.0.0.1:${port}${app?.appPath || "/docs"}`,
  };
}

function defaultRequest(targetUrl, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const req = http.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode || 0 });
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function probeVoiceStudioHealth(app, settings = {}, {
  request = defaultRequest,
  timeoutMs = 1500,
} = {}) {
  const { healthUrl } = voicestudioUrl(app, settings);
  try {
    const response = await request(healthUrl, { timeoutMs });
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}
