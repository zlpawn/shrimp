import crypto from "node:crypto";
import os from "node:os";
import http2 from "node:http2";
import zlib from "node:zlib";
import { createTunneledTlsSocket, requestWithProxy } from "./proxy.mjs";
import {
  encodeGenerateContentRequest,
  decodeGenerateContentResponse,
  decodeUserQuotaSummary,
  normalizeUserQuotaSummary,
} from "./proto.mjs";

export const ANTIGRAVITY_VERSION = "4.3.0";
export const GENERATE_PATH = "/google.internal.cloud.code.v1internal.PredictionService/GenerateContent";
export const QUOTA_SUMMARY_PATH = "/google.internal.cloud.code.v1internal.PredictionService/RetrieveUserQuotaSummary";

const PLATFORM_UA =
  process.platform === "darwin"
    ? "Macintosh; Intel Mac OS X 10_15_7"
    : process.platform === "win32"
      ? "Windows NT 10.0; Win64; x64"
      : "X11; Linux x86_64";

export const UPSTREAM_USER_AGENT = `Antigravity/${ANTIGRAVITY_VERSION} (${PLATFORM_UA}) Chrome/132.0.6834.160 Electron/39.2.3`;

export const ANTIGRAVITY_IDENTITY =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.\n" +
  "You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\n" +
  "**Absolute paths only**\n" +
  "**Proactiveness**";

const SESSION_UUID = crypto.randomUUID();

function getMachineId() {
  const home = os.userInfo().homedir || os.homedir();
  return crypto.createHash("sha256").update(`${os.hostname()}:${home}`).digest("hex").slice(0, 32);
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;
const SIGN_BIT = 1n << 63n;
const TWO64 = 1n << 64n;

export function deriveSessionId(accountId = "") {
  let hash = FNV_OFFSET;
  const bytes = Buffer.from(String(accountId), "utf8");
  for (const b of bytes) {
    hash = (hash * FNV_PRIME) & MASK64;
    hash = hash ^ BigInt(b);
  }
  if (hash >= SIGN_BIT) hash -= TWO64;
  return hash.toString();
}

function getRestBaseUrls(env = process.env) {
  if (env?.ANTIGRAVITY_REST_BASE_URL) return [env.ANTIGRAVITY_REST_BASE_URL];
  return [
    "https://daily-cloudcode-pa.googleapis.com/v1internal",
    "https://cloudcode-pa.googleapis.com/v1internal",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal",
  ];
}

function buildRestHeaders(accessToken, project = null) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": UPSTREAM_USER_AGENT,
    "x-client-name": "antigravity",
    "x-client-version": ANTIGRAVITY_VERSION,
    "x-machine-id": getMachineId(),
    "x-vscode-sessionid": SESSION_UUID,
  };
  if (project) headers["x-goog-user-project"] = project;
  return headers;
}

async function callV1InternalRest({ method, accessToken, body = {}, project = null, proxyUrl = "", env = process.env }) {
  const bases = getRestBaseUrls(env);
  let lastError = null;

  for (const base of bases) {
    const url = `${base}:${method}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await requestWithProxy(url, {
          method: "POST",
          headers: buildRestHeaders(accessToken, project),
          body,
          proxyUrl,
          timeoutMs: 30000,
        });
        if (res.ok) return res;
        if (res.status === 408 || res.status === 404 || (res.status >= 500 && res.status < 600)) {
          lastError = new Error(`${method} (${base}) 返回 HTTP ${res.status}`);
          break;
        }
        const errText = await res.text();
        throw new Error(`${method} 请求失败 (${res.status}): ${errText.slice(0, 300)}`);
      } catch (err) {
        lastError = err;
        if (err.message && err.message.includes("请求失败 (")) throw err;
        if (attempt === 1 && /TLS|ECONNRESET|ETIMEDOUT|socket|CONNECT/i.test(String(err?.message || ""))) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        break;
      }
    }
  }
  throw lastError || new Error(`${method} 请求所有端点均失败`);
}

export async function loadCodeAssist({ accessToken, proxyUrl = "", env = process.env }) {
  const res = await callV1InternalRest({
    method: "loadCodeAssist",
    accessToken,
    body: { metadata: { ideType: "ANTIGRAVITY" } },
    proxyUrl,
    env,
  });
  const data = await res.json();
  const project = data?.cloudaicompanionProject;
  if (!project) {
    throw new Error("loadCodeAssist 未返回 cloudaicompanionProject，请确认当前 Google 账号具备 Antigravity 订阅资格。");
  }
  return { project, raw: data };
}

export async function fetchRemoteModels({ accessToken, project = null, proxyUrl = "", env = process.env }) {
  const res = await callV1InternalRest({
    method: "fetchAvailableModels",
    accessToken,
    body: project ? { project } : {},
    proxyUrl,
    env,
  });
  const data = await res.json();
  const modelsObj = data?.models || {};
  const allModels = Object.entries(modelsObj)
    .map(([id, meta]) => ({
      id,
      displayName: meta?.displayName || id,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const chatModels = allModels.filter(
    (m) => /^(gemini|claude|gpt|chat_)/i.test(m.id) && !/image|imagen/i.test(m.id),
  );
  return { allModels, chatModels };
}

export function buildChatGenerateRequest({
  contents = [],
  system = "",
  model = "gemini-3.8-flash-high",
  temperature = undefined,
  topP = undefined,
  maxOutputTokens = undefined,
  thinkingBudget = undefined,
  includeThoughts = undefined,
  project,
  accountId = "",
}) {
  const systemParts = [{ text: ANTIGRAVITY_IDENTITY }];
  const cleanSystem = typeof system === "string" ? system.trim() : "";
  if (cleanSystem) systemParts.push({ text: cleanSystem });

  const generationConfig = {};
  if (temperature != null && Number.isFinite(Number(temperature))) {
    generationConfig.temperature = Number(temperature);
  }
  if (topP != null && Number.isFinite(Number(topP))) {
    generationConfig.topP = Number(topP);
  }
  if (maxOutputTokens != null && Number.isFinite(Number(maxOutputTokens))) {
    generationConfig.maxOutputTokens = Math.floor(Number(maxOutputTokens));
  }
  if (thinkingBudget != null || includeThoughts != null) {
    generationConfig.thinkingConfig = {};
    if (includeThoughts != null) generationConfig.thinkingConfig.includeThoughts = Boolean(includeThoughts);
    if (thinkingBudget != null && Number.isFinite(Number(thinkingBudget))) {
      generationConfig.thinkingConfig.thinkingBudget = Math.floor(Number(thinkingBudget));
    }
  }

  const sessionId = deriveSessionId(accountId);
  const messageCount = Math.max(contents.length, 1);
  const requestId = `agent/antigravity/${sessionId.slice(0, 8)}/${messageCount}`;

  const inner = {
    systemInstruction: {
      role: "user",
      parts: systemParts,
    },
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    sessionId,
    contents,
  };

  return {
    project,
    requestId,
    request: inner,
    model,
    userAgent: "antigravity",
    requestType: "agent",
    enabledCreditTypes: ["GOOGLE_ONE_AI"],
  };
}

async function* readGrpcFrames(stream, { respEncoding = "" } = {}) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5) {
      const compressed = buffer[0] === 1;
      const len = buffer.readUInt32BE(1);
      if (buffer.length < 5 + len) break;
      let payload = buffer.subarray(5, 5 + len);
      buffer = buffer.subarray(5 + len);
      if (compressed && (!respEncoding || respEncoding.includes("gzip"))) {
        payload = zlib.gunzipSync(payload);
      }
      yield payload;
    }
  }
}

const GRPC_STATUS_HINTS = {
  "3": "INVALID_ARGUMENT（请求参数或上下文格式不合法）",
  "5": "NOT_FOUND（模型不存在或当前 Antigravity 订阅尚未开放该模型）",
  "7": "PERMISSION_DENIED（账号权限或项目不可用）",
  "8": "RESOURCE_EXHAUSTED（订阅配额耗尽或 Google 云端容量繁忙，请稍后重试）",
  "14": "UNAVAILABLE（上游服务暂时不可用或代理连接中断）",
  "16": "UNAUTHENTICATED（OAuth 令牌失效，请重新执行 login）",
};

async function openGrpcH2Client({ proxyUrl = "", env = process.env }) {
  const grpcHost = env?.ANTIGRAVITY_GRPC_HOST || "daily-cloudcode-pa.googleapis.com";
  const grpcPort = parseInt(env?.ANTIGRAVITY_GRPC_PORT || "443", 10);
  const insecure = env?.ANTIGRAVITY_GRPC_INSECURE === "1";

  if (insecure) {
    return {
      insecure: true,
      tlsSocket: null,
      client: http2.connect(`http://${grpcHost}:${grpcPort}`),
    };
  }
  const tlsSocket = await createTunneledTlsSocket({
    host: grpcHost,
    port: grpcPort,
    proxyUrl,
    alpnProtocols: ["h2"],
    timeoutMs: 15000,
  });
  if (typeof tlsSocket.setKeepAlive === "function") {
    try { tlsSocket.setKeepAlive(true, 10000); } catch {}
  }
  const client = http2.connect(`https://${grpcHost}`, {
    createConnection: () => tlsSocket,
  });
  return { insecure: false, tlsSocket, client };
}

function buildGrpcHeaders(accessToken) {
  return {
    "content-type": "application/grpc",
    "grpc-accept-encoding": "gzip",
    te: "trailers",
    authorization: `Bearer ${accessToken}`,
    "user-agent": UPSTREAM_USER_AGENT,
    "x-client-name": "antigravity",
    "x-client-version": ANTIGRAVITY_VERSION,
  };
}

function throwIfGrpcError(statusRaw, msgRaw) {
  const status = String(statusRaw ?? "0");
  if (!status || status === "0") return;
  let decodedMsg = msgRaw || "";
  try {
    decodedMsg = decodeURIComponent(decodedMsg);
  } catch {}
  const hint = GRPC_STATUS_HINTS[status] ? ` [${GRPC_STATUS_HINTS[status]}]` : "";
  const err = new Error(`Antigravity gRPC 错误 (status=${status})${hint}: ${decodedMsg}`);
  err.grpcStatus = status;
  throw err;
}

export async function chatViaGrpc({
  accessToken,
  body,
  proxyUrl = "",
  env = process.env,
  timeoutMs = 180000,
  onText = null,
  onThought = null,
}) {
  const requestBuf = encodeGenerateContentRequest(body);
  const frame = Buffer.alloc(5 + requestBuf.length);
  frame.writeUInt32BE(requestBuf.length, 1);
  requestBuf.copy(frame, 5);

  const { insecure, tlsSocket, client } = await openGrpcH2Client({ proxyUrl, env });

  let idleTimer = null;
  let pingTimer = null;
  let reqRef = null;

  const resetIdleTimer = (ms) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const timeoutErr = new Error(`gRPC 问答流空闲超时 (${Math.round(ms / 1000)}s 无响应数据)`);
      try { reqRef?.destroy(timeoutErr); } catch {}
      try { client.destroy(timeoutErr); } catch {}
      if (tlsSocket && !tlsSocket.destroyed) {
        try { tlsSocket.destroy(timeoutErr); } catch {}
      }
    }, ms);
    if (typeof idleTimer.unref === "function") idleTimer.unref();
  };

  try {
    if (!insecure) {
      pingTimer = setInterval(() => {
        if (!client.destroyed && !client.closed) {
          try { client.ping(() => {}); } catch {}
        }
      }, 10000);
      if (typeof pingTimer.unref === "function") pingTimer.unref();
    }

    const req = client.request({
      ":method": "POST",
      ":path": GENERATE_PATH,
      ...buildGrpcHeaders(accessToken),
    });
    reqRef = req;
    resetIdleTimer(timeoutMs);

    let respHeaders = {};
    let trailers = {};
    req.on("response", (h) => {
      respHeaders = h;
      resetIdleTimer(60000);
    });
    req.on("data", () => {
      resetIdleTimer(60000);
    });
    const trailerPromise = new Promise((resolve) => {
      req.on("trailers", (t) => {
        trailers = t;
        resolve();
      });
      req.on("close", () => resolve());
    });

    req.end(frame);

    const textChunks = [];
    const thoughtChunks = [];
    let finishReason = null;
    let finishMessage = null;
    let modelVersion = null;
    let usage = null;
    let consumedCredits = null;
    let remainingCredits = null;

    for await (const payload of readGrpcFrames(req, {
      respEncoding: String(respHeaders["grpc-encoding"] || ""),
    })) {
      const decoded = decodeGenerateContentResponse(payload);
      if (decoded.consumedCredits != null) consumedCredits = decoded.consumedCredits;
      if (decoded.remainingCredits != null) remainingCredits = decoded.remainingCredits;

      const inner = decoded?.response || decoded;
      if (inner?.modelVersion) modelVersion = inner.modelVersion;
      if (inner?.usageMetadata) {
        const um = inner.usageMetadata;
        usage = {
          input_tokens: um.promptTokenCount ?? 0,
          output_tokens: um.candidatesTokenCount ?? 0,
          total_tokens: um.totalTokenCount ?? (um.promptTokenCount ?? 0) + (um.candidatesTokenCount ?? 0),
          ...(um.thoughtsTokenCount != null ? { thinking_tokens: um.thoughtsTokenCount } : {}),
          ...(um.cachedContentTokenCount != null ? { cached_tokens: um.cachedContentTokenCount } : {}),
        };
      }

      const candidates = Array.isArray(inner?.candidates) ? inner.candidates : [];
      for (const cand of candidates) {
        if (cand.finishReason && cand.finishReason !== "FINISH_REASON_UNSPECIFIED") {
          finishReason = cand.finishReason;
        }
        if (cand.finishMessage) finishMessage = cand.finishMessage;
        for (const part of cand?.content?.parts || []) {
          if (typeof part?.text !== "string" || part.text === "") continue;
          if (part.thought) {
            thoughtChunks.push(part.text);
            if (typeof onThought === "function") onThought(part.text);
          } else {
            textChunks.push(part.text);
            if (typeof onText === "function") onText(part.text);
          }
        }
      }
    }

    await trailerPromise;
    throwIfGrpcError(
      trailers["grpc-status"] ?? respHeaders["grpc-status"],
      trailers["grpc-message"] || respHeaders["grpc-message"],
    );

    return {
      text: textChunks.join(""),
      thinking: thoughtChunks.join(""),
      finishReason: finishReason || "STOP",
      finishMessage,
      modelVersion,
      usage,
      consumedCredits,
      remainingCredits,
    };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (pingTimer) clearInterval(pingTimer);
    try { client.destroy(); } catch {}
    if (tlsSocket && !tlsSocket.destroyed) {
      try { tlsSocket.destroy(); } catch {}
    }
  }
}

export async function retrieveQuotaViaGrpc({
  accessToken,
  proxyUrl = "",
  env = process.env,
  timeoutMs = 15000,
}) {
  const { tlsSocket, client } = await openGrpcH2Client({ proxyUrl, env });
  const frame = Buffer.alloc(5); // 0-length proto payload

  try {
    const req = client.request({
      ":method": "POST",
      ":path": QUOTA_SUMMARY_PATH,
      ...buildGrpcHeaders(accessToken),
    });
    if (typeof req.setTimeout === "function") {
      req.setTimeout(timeoutMs, () => req.destroy(new Error("Antigravity quota gRPC request timed out")));
    }

    let respHeaders = {};
    let trailers = {};
    req.on("response", (h) => { respHeaders = h; });
    const trailerPromise = new Promise((resolve) => {
      req.on("trailers", (t) => { trailers = t; resolve(); });
      req.on("close", () => resolve());
    });
    req.end(frame);

    const payloads = [];
    for await (const payload of readGrpcFrames(req, {
      respEncoding: String(respHeaders["grpc-encoding"] || ""),
    })) {
      payloads.push(payload);
    }
    await trailerPromise;
    throwIfGrpcError(
      trailers["grpc-status"] ?? respHeaders["grpc-status"],
      trailers["grpc-message"] || respHeaders["grpc-message"],
    );
    if (payloads.length !== 1) {
      throw new Error(`Quota gRPC 响应期望 1 个帧，实际收到 ${payloads.length}`);
    }
    return normalizeUserQuotaSummary(decodeUserQuotaSummary(payloads[0]));
  } finally {
    try { client.destroy(); } catch {}
    if (tlsSocket && !tlsSocket.destroyed) {
      try { tlsSocket.destroy(); } catch {}
    }
  }
}
