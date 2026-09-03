import http from "node:http";
import { spawn } from "node:child_process";
import { CommandAppsError } from "../domain/errors.mjs";
import { sanitizeDaemonEnv } from "./hindsight-daemon.mjs";

export const HINDSIGHT_CONTROL_PLANE_PACKAGE = "@vectorize-io/hindsight-control-plane@0.9.2";
export const DEFAULT_HINDSIGHT_CONTROL_PLANE_PORT = 19078;

function controlPlaneUrl(port, bankId) {
  return `http://127.0.0.1:${port}/banks/${encodeURIComponent(bankId)}`;
}

function healthUrl(port) {
  return `http://127.0.0.1:${port}/api/health`;
}

function isHealthyResponse(result) {
  if (typeof result === "boolean") return result;
  return Number(result?.statusCode) >= 200 && Number(result?.statusCode) < 300;
}

function defaultProbe(url, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode || 0 });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Control Plane health probe timed out"));
    });
    req.on("error", reject);
  });
}

export async function ensureHindsightControlPlane({
  apiUrl = "http://127.0.0.1:9077",
  port = DEFAULT_HINDSIGHT_CONTROL_PLANE_PORT,
  bankId = "coding-agent::local-ai-gateway",
  probe = defaultProbe,
  spawnProcess = spawn,
  waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 30000,
  pollMs = 500,
  env = sanitizeDaemonEnv(),
} = {}) {
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort >= 65536) {
    throw new CommandAppsError("invalid_request", "Control Plane port must be between 1 and 65535");
  }
  if (!bankId || typeof bankId !== "string") {
    throw new CommandAppsError("invalid_request", "A Hindsight bank id is required");
  }

  const check = async () => {
    try {
      return isHealthyResponse(await probe(healthUrl(normalizedPort)));
    } catch {
      return false;
    }
  };
  const base = {
    port: normalizedPort,
    apiUrl,
    bankId,
    url: controlPlaneUrl(normalizedPort, bankId),
  };
  const alreadyRunning = await check();
  if (alreadyRunning) {
    return { ...base, running: true, alreadyRunning: true };
  }

  const child = spawnProcess("npx", [
    HINDSIGHT_CONTROL_PLANE_PACKAGE,
    "--port",
    String(normalizedPort),
    "--hostname",
    "0.0.0.0",
    "--api-url",
    apiUrl,
  ], {
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  });
  if (typeof child?.unref === "function") child.unref();

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return { ...base, running: true, alreadyRunning: false, pid: child?.pid || null };
    }
    await waitMs(pollMs);
  }
  throw new CommandAppsError(
    "process_error",
    "Hindsight Control Plane failed to become healthy",
  );
}
