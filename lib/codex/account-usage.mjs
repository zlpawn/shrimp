import { spawn } from "node:child_process";

function unavailable(code, message) {
  return {
    available: false,
    remaining_percent: null,
    reset_at: null,
    plan_type: null,
    primary: null,
    secondary: null,
    credits: null,
    buckets: [],
    updated_at: null,
    error: { code, message },
  };
}

function normalizeWindow(window) {
  if (!window) return null;
  const used = Number.isFinite(Number(window.usedPercent)) ? Number(window.usedPercent) : null;
  return {
    used_percent: used,
    remaining_percent: used === null ? null : Math.max(0, 100 - used),
    resets_at: window.resetsAt ?? null,
    window_minutes: window.windowDurationMins ?? null,
  };
}

function normalizeSnapshot(snapshot = {}) {
  const primary = normalizeWindow(snapshot.primary);
  const secondary = normalizeWindow(snapshot.secondary);
  const credits = snapshot.credits
    ? {
      available: Boolean(snapshot.credits.hasCredits),
      unlimited: Boolean(snapshot.credits.unlimited),
      balance: snapshot.credits.balance ?? null,
    }
    : null;
  return {
    limit_id: snapshot.limitId || "codex",
    limit_name: snapshot.limitName || "",
    plan_type: snapshot.planType || null,
    primary,
    secondary,
    credits,
    remaining_percent: primary?.remaining_percent ?? null,
    reset_at: primary?.resets_at ?? null,
  };
}

export function normalizeCodexRateLimits(payload = {}) {
  const primary = normalizeSnapshot(payload.rateLimits);
  const buckets = Object.values(payload.rateLimitsByLimitId || {}).map(normalizeSnapshot);
  return {
    available: true,
    remaining_percent: primary.remaining_percent,
    reset_at: primary.reset_at,
    plan_type: primary.plan_type,
    primary: primary.primary,
    secondary: primary.secondary,
    credits: primary.credits,
    buckets,
    updated_at: new Date().toISOString(),
    error: null,
  };
}

function sendMessage(proc, message) {
  proc.stdin.write(JSON.stringify(message) + "\n");
}

function request(proc, id, method, params = null) {
  sendMessage(proc, { jsonrpc: "2.0", id, method, params });
}

export async function readCodexAccountUsage({
  command = process.env.CODEX_APP_SERVER_COMMAND || "codex",
  args = ["app-server", "--stdio"],
  spawnImpl = spawn,
  timeoutMs = 15000,
} = {}) {
  const commandParts = String(command || "").trim().split(/[ 	]+/).filter(Boolean);
  const resolvedCommand = commandParts[0] || command;
  const resolvedArgs = commandParts.length > 1 ? commandParts.slice(1) : args;
  const proc = spawnImpl(resolvedCommand, resolvedArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  let nextId = 1;
  const pending = new Map();
  const notifications = [];

  proc.stdout.setEncoding?.("utf8");
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || "Codex app-server request failed"));
        else resolve(message.result);
      } else {
        notifications.push(message);
      }
    }
  });

  const waitFor = (id) => new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  const timeout = setTimeout(() => {
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(new Error("Codex app-server request timed out"));
    }
    pending.clear();
    proc.kill();
  }, timeoutMs);
  if (typeof timeout.unref === "function") timeout.unref();

  try {
    const initializeId = nextId++;
    const initialize = waitFor(initializeId);
    request(proc, initializeId, "initialize", {
      clientInfo: { name: "shrimp-gateway", version: "0.0.3" },
      capabilities: null,
    });
    await initialize;
    const usageId = nextId++;
    const usage = waitFor(usageId);
    request(proc, usageId, "account/rateLimits/read", null);
    const result = await usage;
    return normalizeCodexRateLimits(result || {});
  } catch (error) {
    return unavailable("codex_usage_failed", error?.message || String(error));
  } finally {
    clearTimeout(timeout);
    proc.kill();
  }
}
