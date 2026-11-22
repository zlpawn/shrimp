import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_BIN_OFM_DIR,
  getInstalledOfmInfo,
  checkOfmUpdate,
  updateOfmCoreFromGithub,
} from "./updater.mjs";
import { resolveUserLocalProxy } from "./proxy.mjs";

const execFileP = promisify(execFile);

export const DEFAULT_OFM_PORT = 18900;
export const DEFAULT_OFM_DATA_DIR = path.join(os.homedir(), ".shrimp", "providers", "ofm");

export const OFM_CHANNEL_PROVIDERS = [
  { id: "zcode", name: "ZCode (智谱)", highlight: "GLM-5.3 / GLM-5.3-Flash" },
  { id: "qodercn", name: "Qoder (中国版 · 阿里)", highlight: "GLM-5.3 / GLM-5.2 / DeepSeek-V4-Pro / Kimi-K3" },
  { id: "qoder", name: "Qoder (国际版 · 阿里)", highlight: "GLM-5.3 / DeepSeek-V4-Pro / Kimi-K3" },
  { id: "trae", name: "TRAE (字节跳动)", highlight: "DeepSeek-V4-Pro / GLM-5.2 / GLM-5" },
  { id: "lobsterai", name: "LobsterAI (网易有道)", highlight: "deepseek-v4-pro / glm-5.2" },
  { id: "raccoon", name: "Raccoon (商汤小浣熊)", highlight: "GLM-5-3 / Kimi-K3 / DeepSeek-V4.1-Flash" },
  { id: "loomy", name: "Loomy (科大讯飞)", highlight: "GLM-5.3-Flash / DeepSeek-V4-Flash / Qwen" },
  { id: "minimax", name: "MiniMax Code", highlight: "MiniMax-M3 / MiniMax-M2.7" },
  { id: "cline", name: "Cline", highlight: "mimo-v2.6-flash" },
  { id: "gemini", name: "Gemini Code Assist", highlight: "Gemini 2.5 Pro / Flash" },
];

export function resolveOfmDataDir(customDataDir = "") {
  if (customDataDir && String(customDataDir).trim()) {
    return path.resolve(String(customDataDir).trim());
  }
  return DEFAULT_OFM_DATA_DIR;
}

export function resolvePidFile(port = DEFAULT_OFM_PORT, dataDir = DEFAULT_OFM_DATA_DIR) {
  const p = Number(port) || DEFAULT_OFM_PORT;
  const dir = resolveOfmDataDir(dataDir);
  if (p === DEFAULT_OFM_PORT) {
    return path.join(dir, "supervisor.pid");
  }
  return path.join(dir, `supervisor-${p}.pid`);
}

export function resolveLogFile(port = DEFAULT_OFM_PORT, dataDir = DEFAULT_OFM_DATA_DIR) {
  const p = Number(port) || DEFAULT_OFM_PORT;
  const dir = resolveOfmDataDir(dataDir);
  if (p === DEFAULT_OFM_PORT) {
    return path.join(dir, "supervisor.log");
  }
  return path.join(dir, `supervisor-${p}.log`);
}

export function resolveOfmCli({ binOfmDir = DEFAULT_BIN_OFM_DIR } = {}) {
  const info = getInstalledOfmInfo(binOfmDir);
  return {
    installed: info.installed,
    cliPath: info.installed ? info.cliPath : null,
    binOfmDir: info.binOfmDir,
    version: info.version,
    coreVersion: info.coreVersion,
    commitSha: info.commitSha,
    syncedAt: info.syncedAt,
  };
}

export function readOfmSettings(dataDir = DEFAULT_OFM_DATA_DIR) {
  const dir = resolveOfmDataDir(dataDir);
  const file = path.join(dir, "settings.json");
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    return {};
  }
}

export function readOfmForwardKey(dataDir = DEFAULT_OFM_DATA_DIR) {
  const settings = readOfmSettings(dataDir);
  return typeof settings.forwardKey === "string" ? settings.forwardKey.trim() : "";
}

export function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function readPid(pidFile = null, port = DEFAULT_OFM_PORT, dataDir = DEFAULT_OFM_DATA_DIR) {
  const file = pidFile || resolvePidFile(port, dataDir);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {}
  return null;
}

export function writePid(pid, pidFile = null, port = DEFAULT_OFM_PORT, dataDir = DEFAULT_OFM_DATA_DIR) {
  const file = pidFile || resolvePidFile(port, dataDir);
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, String(pid), "utf8");
  } catch (err) {
    console.error(`[OfmSupervisor] Failed to write PID file ${file}:`, err);
  }
}

export function removePid(pidFile = null, port = DEFAULT_OFM_PORT, dataDir = DEFAULT_OFM_DATA_DIR) {
  const file = pidFile || resolvePidFile(port, dataDir);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

export async function findPidByPort(port = DEFAULT_OFM_PORT) {
  const p = Number(port) || DEFAULT_OFM_PORT;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileP("netstat", ["-ano"], { windowsHide: true });
      for (const line of stdout.split("\n")) {
        if (line.includes(`:${p} `) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
      }
    } else {
      const { stdout } = await execFileP("lsof", ["-ti", `tcp:${p}`, "-sTCP:LISTEN"]);
      const pid = parseInt(stdout.trim().split("\n")[0], 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch {}
  return null;
}

export async function checkHealth(port = DEFAULT_OFM_PORT, timeoutMs = 1500) {
  const p = Number(port) || DEFAULT_OFM_PORT;
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${p}/health`,
      { timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {}
          const ok = res.statusCode === 200 && (parsed?.ok !== false);
          resolve({ ok, status: res.statusCode, data: parsed || data });
        });
      },
    );
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, timeout: true });
    });
  });
}

function httpJsonRequest(urlStr, { method = "GET", headers = {}, body = null, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = body !== null && body !== undefined
      ? (typeof body === "string" ? body : JSON.stringify(body))
      : null;
    const reqHeaders = {
      Accept: "application/json",
      ...headers,
    };
    if (bodyStr !== null) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {}
          resolve({
            status: res.statusCode || 0,
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            data: parsed,
            text,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`OFM request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (bodyStr !== null) req.write(bodyStr);
    req.end();
  });
}

export async function callOfmChannelRpc(
  method,
  payload = {},
  {
    port = DEFAULT_OFM_PORT,
    dataDir = DEFAULT_OFM_DATA_DIR,
    timeoutMs = 30_000,
  } = {},
) {
  const resolvedPort = Number(port) || DEFAULT_OFM_PORT;
  const resolvedDataDir = resolveOfmDataDir(dataDir);
  const forwardKey = readOfmForwardKey(resolvedDataDir);
  if (!forwardKey) {
    throw new Error("OFM 服务尚未生成 forwardKey，请先启动 OFM 服务");
  }

  const res = await httpJsonRequest(
    `http://127.0.0.1:${resolvedPort}/api/management/channels/rpc`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${forwardKey}`,
      },
      body: { method, payload },
      timeoutMs,
    },
  );

  if (!res.ok) {
    throw new Error(res.data?.error?.message || res.data?.error || `OFM RPC ${method} 失败 (HTTP ${res.status})`);
  }
  if (res.data && res.data.ok === false) {
    throw new Error(res.data.error?.message || res.data.error || `OFM RPC ${method} 执行失败`);
  }
  return res.data?.value !== undefined ? res.data.value : res.data;
}

export async function fetchOfmAccountsSummary({
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  const providerIds = OFM_CHANNEL_PROVIDERS.map((p) => p.id);
  const [statusRes, autoCheckinRes, ...accountLists] = await Promise.all([
    callOfmChannelRpc("provider.status", { providers: providerIds }, { port, dataDir }).catch(() => ({ statuses: {} })),
    callOfmChannelRpc("usage.autoCheckin", {}, { port, dataDir }).catch(() => ({ enabled: true })),
    ...providerIds.map((provider) =>
      callOfmChannelRpc("account.list", { provider }, { port, dataDir })
        .then((val) => ({ provider, accounts: Array.isArray(val?.accounts) ? val.accounts : [] }))
        .catch(() => ({ provider, accounts: [] })),
    ),
  ]);

  const statuses = statusRes?.statuses || {};
  const allAccounts = [];
  const providersSummary = OFM_CHANNEL_PROVIDERS.map((meta) => {
    const found = accountLists.find((item) => item.provider === meta.id);
    const accs = (found?.accounts || []).map((acc) => ({
      ...acc,
      provider: meta.id,
      providerName: meta.name,
    }));
    allAccounts.push(...accs);
    return {
      ...meta,
      closed: statuses[meta.id]?.closed === true,
      enabled: statuses[meta.id]?.closed !== true,
      accountCount: accs.length,
      accounts: accs,
    };
  });

  return {
    providers: providersSummary,
    accounts: allAccounts,
    autoCheckin: autoCheckinRes?.enabled !== false,
  };
}

export async function start({
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_OFM_PORT;
  const resolvedDataDir = resolveOfmDataDir(dataDir);
  const resolvedPid = resolvePidFile(resolvedPort, resolvedDataDir);
  const resolvedLog = resolveLogFile(resolvedPort, resolvedDataDir);

  const existingHealth = await checkHealth(resolvedPort, 1000);
  if (existingHealth.ok) {
    let pid = readPid(resolvedPid, resolvedPort, resolvedDataDir);
    if (!pid || !isPidAlive(pid)) {
      pid = await findPidByPort(resolvedPort);
      if (pid) writePid(pid, resolvedPid, resolvedPort, resolvedDataDir);
    }
    return {
      ok: true,
      alreadyRunning: true,
      pid: pid || null,
      port: resolvedPort,
      dataDir: resolvedDataDir,
    };
  }

  let runtime = resolveOfmCli();
  if (!runtime.installed) {
    // Auto-pull from GitHub via user's local system proxy if bin/ofm is missing
    await updateOfmCoreFromGithub();
    runtime = resolveOfmCli();
  }
  if (!runtime.installed || !runtime.cliPath) {
    throw new Error("未找到 bin/ofm 核心运行时，请点击「检查/更新 OFM 核心」或运行 npm run sync:ofm");
  }

  fs.mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });

  // Remove stale lock if previous PID is dead
  const lockFile = path.join(resolvedDataDir, "service.lock");
  if (fs.existsSync(lockFile)) {
    try {
      const lockObj = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      if (lockObj?.pid && !isPidAlive(lockObj.pid)) {
        fs.unlinkSync(lockFile);
      }
    } catch {}
  }

  const out = fs.openSync(resolvedLog, "a");
  const err = fs.openSync(resolvedLog, "a");

  const userProxy = resolveUserLocalProxy();
  const childEnv = {
    ...process.env,
    OFM_HOME: resolvedDataDir,
  };
  if (userProxy.url && !childEnv.HTTPS_PROXY && !childEnv.HTTP_PROXY) {
    childEnv.HTTPS_PROXY = userProxy.url;
    childEnv.HTTP_PROXY = userProxy.url;
  }

  const child = spawn(
    process.execPath,
    [runtime.cliPath, "--port", String(resolvedPort), "--data-dir", resolvedDataDir],
    {
      detached: true,
      stdio: ["ignore", out, err],
      env: childEnv,
      windowsHide: true,
    },
  );

  child.unref();
  writePid(child.pid, resolvedPid, resolvedPort, resolvedDataDir);

  const startAt = Date.now();
  while (Date.now() - startAt < 15_000) {
    await new Promise((r) => setTimeout(r, 350));
    const health = await checkHealth(resolvedPort, 1000);
    if (health.ok) {
      return {
        ok: true,
        pid: child.pid,
        port: resolvedPort,
        dataDir: resolvedDataDir,
        cliPath: runtime.cliPath,
        version: runtime.version,
      };
    }
    if (!isPidAlive(child.pid)) {
      removePid(resolvedPid, resolvedPort, resolvedDataDir);
      throw new Error(`OFM 服务启动后异常退出，请检查日志：${resolvedLog}`);
    }
  }

  throw new Error(`OFM 服务启动超时（15s 内未就绪），请检查日志：${resolvedLog}`);
}

export async function stop({
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_OFM_PORT;
  const resolvedDataDir = resolveOfmDataDir(dataDir);
  const resolvedPid = resolvePidFile(resolvedPort, resolvedDataDir);

  let pid = readPid(resolvedPid, resolvedPort, resolvedDataDir);
  if (!pid || !isPidAlive(pid)) {
    const detected = await findPidByPort(resolvedPort);
    if (detected && isPidAlive(detected)) {
      pid = detected;
    }
  }

  if (pid && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    const startAt = Date.now();
    while (Date.now() - startAt < 3500) {
      await new Promise((r) => setTimeout(r, 200));
      if (!isPidAlive(pid)) break;
    }
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }

  removePid(resolvedPid, resolvedPort, resolvedDataDir);
  const lockFile = path.join(resolvedDataDir, "service.lock");
  if (fs.existsSync(lockFile)) {
    try {
      const lockObj = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      if (!lockObj?.pid || !isPidAlive(lockObj.pid)) {
        fs.unlinkSync(lockFile);
      }
    } catch {}
  }

  const health = await checkHealth(resolvedPort, 500);
  return { ok: true, stopped: !health.ok, port: resolvedPort };
}

let ensureInFlight = null;

export async function ensureReady({
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_OFM_PORT;
  const health = await checkHealth(resolvedPort, 1000);
  if (health.ok) {
    return {
      ok: true,
      running: true,
      port: resolvedPort,
      dataDir: resolveOfmDataDir(dataDir),
      forwardKey: readOfmForwardKey(dataDir),
    };
  }
  if (!ensureInFlight) {
    ensureInFlight = start({ port: resolvedPort, dataDir }).finally(() => {
      ensureInFlight = null;
    });
  }
  const started = await ensureInFlight;
  return {
    ...started,
    running: true,
    forwardKey: readOfmForwardKey(dataDir),
  };
}

export async function getStatus({
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  const resolvedPort = Number(port) || DEFAULT_OFM_PORT;
  const resolvedDataDir = resolveOfmDataDir(dataDir);
  const resolvedPidFile = resolvePidFile(resolvedPort, resolvedDataDir);
  const runtime = resolveOfmCli();

  let pid = readPid(resolvedPidFile, resolvedPort, resolvedDataDir);
  let processAlive = pid ? isPidAlive(pid) : false;
  const health = await checkHealth(resolvedPort, 1200);

  if (!processAlive && health.ok) {
    const detectedPid = await findPidByPort(resolvedPort);
    if (detectedPid && isPidAlive(detectedPid)) {
      pid = detectedPid;
      processAlive = true;
      writePid(pid, resolvedPidFile, resolvedPort, resolvedDataDir);
    }
  }

  const running = health.ok;
  const forwardKey = readOfmForwardKey(resolvedDataDir);
  let channelSummary = {
    providers: OFM_CHANNEL_PROVIDERS.map((p) => ({
      ...p,
      closed: false,
      enabled: true,
      accountCount: 0,
      accounts: [],
    })),
    accounts: [],
    autoCheckin: true,
  };

  if (running && forwardKey) {
    try {
      channelSummary = await fetchOfmAccountsSummary({
        port: resolvedPort,
        dataDir: resolvedDataDir,
      });
    } catch {}
  }

  return {
    installed: runtime.installed,
    cliPath: runtime.cliPath,
    binOfmDir: runtime.binOfmDir,
    version: runtime.version,
    coreVersion: runtime.coreVersion,
    commitSha: runtime.commitSha,
    syncedAt: runtime.syncedAt,
    running,
    pid: processAlive ? pid : null,
    port: resolvedPort,
    health: health.ok,
    dataDir: resolvedDataDir,
    hasForwardKey: Boolean(forwardKey),
    providers: channelSummary.providers,
    accounts: channelSummary.accounts,
    autoCheckin: channelSummary.autoCheckin,
    localProxy: resolveUserLocalProxy(),
  };
}

export function openInBrowser(targetUrl, {
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  try {
    if (platform === "darwin") {
      const child = spawnImpl("open", [targetUrl], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    if (platform === "win32") {
      const child = spawnImpl("rundll32", ["url.dll,FileProtocolHandler", targetUrl], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    const child = spawnImpl("xdg-open", [targetUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function beginChannelLogin({
  provider,
  zcodeProvider,
  openBrowser = true,
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  if (!provider) throw new Error("请选择要登录的渠道 (provider)");
  await ensureReady({ port, dataDir });
  const result = await callOfmChannelRpc(
    "account.create",
    {
      provider,
      ...(zcodeProvider ? { zcodeProvider } : {}),
    },
    { port, dataDir, timeoutMs: 45_000 },
  );
  if (openBrowser && result?.loginUrl) {
    openInBrowser(result.loginUrl);
  }
  return result;
}

export async function pollChannelLogin({
  accountId,
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  if (!accountId) throw new Error("缺少 accountId");
  return callOfmChannelRpc("login.poll", { accountId }, { port, dataDir });
}

export async function deleteChannelAccount({
  accountId,
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  if (!accountId) throw new Error("缺少 accountId");
  await callOfmChannelRpc("account.delete", { accountId }, { port, dataDir });
  return { ok: true, accountId };
}

export async function testChannelAccount({
  accountId,
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  if (!accountId) throw new Error("缺少 accountId");
  return callOfmChannelRpc("account.test", { accountId }, { port, dataDir, timeoutMs: 60_000 });
}

export async function claimChannelCredits({
  provider,
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  if (provider) {
    return callOfmChannelRpc("credits.claimAll", { provider }, { port, dataDir, timeoutMs: 60_000 });
  }
  const checkinProviders = ["trae", "qoder", "qodercn", "loomy", "raccoon", "lobsterai", "minimax"];
  const results = {};
  for (const p of checkinProviders) {
    try {
      results[p] = await callOfmChannelRpc("credits.claimAll", { provider: p }, { port, dataDir, timeoutMs: 45_000 });
    } catch (err) {
      results[p] = { error: err.message };
    }
  }
  return { results };
}

export async function setAutoCheckin({
  enabled,
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  return callOfmChannelRpc("usage.autoCheckin", { enabled: Boolean(enabled) }, { port, dataDir });
}

export async function toggleChannelProvider({
  provider,
  enabled,
  port = DEFAULT_OFM_PORT,
  dataDir = DEFAULT_OFM_DATA_DIR,
} = {}) {
  if (!provider) throw new Error("缺少 provider");
  return callOfmChannelRpc("provider.setEnabled", { provider, enabled: Boolean(enabled) }, { port, dataDir });
}

export { checkOfmUpdate, updateOfmCoreFromGithub };
