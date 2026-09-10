import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function readJsonFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}

function maskToken(token) {
  const value = String(token || "");
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return value.slice(0, 4) + "*".repeat(Math.max(value.length - 8, 4)) + value.slice(-4);
}

function publicBinding(row) {
  if (!row) return null;
  return {
    bindingKey: row.bindingKey,
    platform: row.platform,
    chatType: row.chatType,
    chatId: row.chatId,
    userId: row.userId || "",
    client: row.client,
    sessionId: row.sessionId,
    workspacePath: row.workspacePath || "",
    title: row.title || "",
    boundByUserId: row.boundByUserId || "",
    lastUsedAt: row.lastUsedAtMs ? new Date(row.lastUsedAtMs).toISOString() : null,
    updatedAt: row.updatedAtMs ? new Date(row.updatedAtMs).toISOString() : null,
  };
}

export function createRemoteAgentConfigService({
  bindingStore,
  sessionKanban,
  secretsPath,
  getSecrets,
  setSecrets,
  getToken,
  setToken,
  listenPort = 8787,
  now = () => Date.now(),
} = {}) {
  if (!bindingStore) throw new Error("bindingStore is required");

  function readSecrets() {
    if (typeof getSecrets === "function") return structuredClone(getSecrets() || {});
    return readJsonFile(secretsPath, { api_keys: {} });
  }

  function saveSecrets(next) {
    if (typeof setSecrets === "function") {
      setSecrets(next);
      return next;
    }
    writeJsonFile(secretsPath, next || { api_keys: {} });
    return next;
  }

  function currentToken() {
    if (typeof getToken === "function") return String(getToken() || "").trim();
    const envToken = String(process.env.REMOTE_AGENT_TOKEN || "").trim();
    if (envToken) return envToken;
    const secrets = readSecrets();
    return String(secrets?.remote_agent?.token || "").trim();
  }

  function persistToken(token) {
    const value = String(token || "").trim();
    if (typeof setToken === "function") {
      setToken(value);
      return value;
    }
    const secrets = readSecrets();
    if (!secrets.remote_agent || typeof secrets.remote_agent !== "object") secrets.remote_agent = {};
    secrets.remote_agent.token = value;
    saveSecrets(secrets);
    process.env.REMOTE_AGENT_TOKEN = value;
    return value;
  }

  async function recentTasks(limit = 20) {
    if (!sessionKanban) return [];
    let rows = [];
    if (typeof sessionKanban.listQueue === "function") {
      rows = await sessionKanban.listQueue();
    } else if (sessionKanban.store && typeof sessionKanban.store.list === "function") {
      rows = sessionKanban.store.list();
    } else if (typeof sessionKanban.board === "function") {
      const board = await sessionKanban.board();
      rows = board.queue || [];
    }
    return rows.slice(0, Number(limit) || 20).map((item) => ({
      id: item.id,
      sessionId: item.sessionId,
      message: item.message,
      status: item.status,
      error: item.error || "",
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
    }));
  }

  return {
    async getStatus() {
      const token = currentToken();
      const bindings = (bindingStore.listBindings?.() || []).map(publicBinding);
      const tasks = await recentTasks(20);
      const port = Number(listenPort) || 8787;
      return {
        ok: true,
        enabled: Boolean(token),
        tokenConfigured: Boolean(token),
        tokenMasked: maskToken(token),
        tokenSource: process.env.REMOTE_AGENT_TOKEN ? "env" : (token ? "secrets" : "none"),
        endpoints: {
          healthUrl: `http://127.0.0.1:${port}/v1/remote-agent/health`,
          messageUrl: `http://127.0.0.1:${port}/v1/remote-agent/message`,
          difyBaseUrl: `http://127.0.0.1:${port}/dify/v1`,
          difyChatMessagesUrl: `http://127.0.0.1:${port}/dify/v1/chat-messages`,
        },
        bindings,
        recentTasks: tasks,
        generatedAt: new Date(now()).toISOString(),
        setupHint: "在 LangBot 中选择 Dify Service API，Base URL 填 difyBaseUrl，API Key 填这里的 Token。",
      };
    },

    async rotateToken() {
      const token = randomBytes(24).toString("hex");
      persistToken(token);
      return {
        ok: true,
        token,
        tokenMasked: maskToken(token),
        tokenSource: process.env.REMOTE_AGENT_TOKEN ? "env" : "secrets",
      };
    },

    async clearBinding(bindingKey) {
      bindingStore.clearBinding(bindingKey);
      return { ok: true, bindingKey: String(bindingKey || "") };
    },
  };
}
