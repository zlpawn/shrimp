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

function decodeJobId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Invalid percent-encoded job id");
  }
}

function isInvalidJobIdError(err) {
  return err instanceof URIError || err?.message === "Invalid percent-encoded job id";
}

export function createSchedulerRoutes({ registry, configStore } = {}) {
  return async function handleSchedulerRequest(req, res, rawPath = "") {
    const method = (req.method || "GET").toUpperCase();
    const url = new URL(rawPath || req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (!pathname.startsWith("/v1/scheduler")) {
      return false;
    }

    // 1. GET /v1/scheduler/jobs
    if (pathname === "/v1/scheduler/jobs" && method === "GET") {
      const jobs = registry.listJobs();
      sendJson(res, 200, { ok: true, jobs });
      return true;
    }

    // 2. POST /v1/scheduler/jobs/:id/run
    const runMatch = pathname.match(/^\/v1\/scheduler\/jobs\/([^/]+)\/run$/);
    if (runMatch && method === "POST") {
      try {
        const jobId = decodeJobId(runMatch[1]);
        const adapter = registry.get(jobId);
        if (!adapter) {
          sendJson(res, 404, { ok: false, error: `Job not found: ${jobId}` });
          return true;
        }

        const result = await registry.runJob(jobId);
        sendJson(res, result.ok ? 200 : 400, result);
      } catch (err) {
        sendJson(res, isInvalidJobIdError(err) ? 400 : 500, { ok: false, error: err.message });
      }
      return true;
    }

    // 3. PATCH /v1/scheduler/jobs/:id/config
    const configMatch = pathname.match(/^\/v1\/scheduler\/jobs\/([^/]+)\/config$/);
    if (configMatch && (method === "PATCH" || method === "POST" || method === "PUT")) {
      try {
        const jobId = decodeJobId(configMatch[1]);
        const adapter = registry.get(jobId);
        if (!adapter) {
          sendJson(res, 404, { ok: false, error: `Job not found: ${jobId}` });
          return true;
        }

        const body = await readJson(req);
        const updatedJob = await registry.updateJobConfig(jobId, body);
        sendJson(res, 200, { ok: true, job: updatedJob });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
      return true;
    }

    return false;
  };
}
