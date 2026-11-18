import crypto from "node:crypto";
import os from "node:os";
import http2 from "node:http2";
import zlib from "node:zlib";
import { createTunneledTlsSocket, requestWithProxy } from "./proxy.mjs";
import { encodeGenerateContentRequest, decodeGenerateContentResponse } from "./proto.mjs";

export const ANTIGRAVITY_VERSION = "4.3.0";
export const GENERATE_PATH = "/google.internal.cloud.code.v1internal.PredictionService/GenerateContent";
export const STREAM_GENERATE_PATH = "/google.internal.cloud.code.v1internal.PredictionService/StreamGenerateContent";

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
        continue;
      }
      const errText = await res.text();
      throw new Error(`${method} 请求失败 (${res.status}): ${errText.slice(0, 300)}`);
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes("请求失败 (")) throw err;
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
  const allModels = Object.entries(modelsObj).map(([id, meta]) => ({
    id,
    displayName: meta?.displayName || id,
  }));
  const imageModels = allModels.filter(
    (m) => /image|imagen/i.test(m.id) || /image|imagen/i.test(m.displayName),
  );
  return { allModels, imageModels };
}

export function normalizeImageSize(size = "", quality = "") {
  const raw = String(size || "").trim();
  if (raw) {
    const upper = raw.toUpperCase();
    if (upper === "0.5K" || upper === "512PX") return "512";
    if (upper === "1K" || upper === "2K" || upper === "4K" || upper === "512") return upper;
    return raw;
  }
  const q = String(quality || "").trim().toLowerCase();
  if (q === "high" || q === "hd" || q === "ultra") return "4K";
  if (q === "medium") return "2K";
  if (q === "low") return "1K";
  return "";
}

export function buildImageGenerateRequest({
  prompt,
  model = "gemini-3.1-flash-image",
  aspectRatio = "auto",
  imageSize = "",
  quality = "",
  imageParts = [],
  project,
  accountId = "",
}) {
  const parts = [{ text: String(prompt ?? "") }];
  for (const imgPart of imageParts) {
    if (imgPart?.inlineData?.data) {
      parts.push({ inlineData: imgPart.inlineData });
    }
  }

  const generationConfig = {
    responseModalities: ["IMAGE"],
  };
  const cleanRatio = aspectRatio && aspectRatio !== "auto" ? String(aspectRatio).trim() : "";
  const cleanSize = normalizeImageSize(imageSize, quality);
  if (cleanRatio || cleanSize) {
    generationConfig.imageConfig = {
      ...(cleanSize === "4K" || cleanSize === "2K"
        ? { imageOutputOptions: { mimeType: "image/jpeg", compressionQuality: cleanSize === "4K" ? 85 : 90 } }
        : {}),
      ...(cleanRatio ? { aspectRatio: cleanRatio } : {}),
      ...(cleanSize ? { imageSize: cleanSize } : {}),
    };
  }

  const sessionId = deriveSessionId(accountId);
  const requestId = `agent/antigravity/${sessionId.slice(0, 8)}/1`;

  return {
    project,
    requestId,
    model,
    userAgent: "antigravity",
    requestType: "agent",
    enabledCreditTypes: ["GOOGLE_ONE_AI"],
    request: {
      systemInstruction: {
        role: "user",
        parts: [{ text: ANTIGRAVITY_IDENTITY }],
      },
      generationConfig,
      sessionId,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
    },
  };
}

async function* readGrpcFrames(stream, { onProgress = null, respEncoding = "" } = {}) {
  let buffer = Buffer.alloc(0);
  let lastReport = 0;
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    if (onProgress && buffer.length >= 5) {
      const expected = buffer.readUInt32BE(1);
      const now = Date.now();
      if (expected > 512 * 1024 && now - lastReport >= 3000) {
        lastReport = now;
        onProgress(Math.min(buffer.length - 5, expected), expected);
      }
    }
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
  "5": "NOT_FOUND（模型不存在或当前 Antigravity 订阅尚未开放该模型）",
  "7": "PERMISSION_DENIED（账号权限或项目不可用）",
  "8": "RESOURCE_EXHAUSTED（订阅配额耗尽或 Google 云端容量繁忙，请稍后重试）",
  "14": "UNAVAILABLE（上游服务暂时不可用或代理连接中断）",
  "16": "UNAUTHENTICATED（OAuth 令牌失效，请重新执行 login）",
};

export async function generateImageViaGrpc({
  accessToken,
  body,
  proxyUrl = "",
  env = process.env,
  timeoutMs = 300000,
  onProgress = null,
}) {
  const grpcHost = env?.ANTIGRAVITY_GRPC_HOST || "daily-cloudcode-pa.googleapis.com";
  const grpcPort = parseInt(env?.ANTIGRAVITY_GRPC_PORT || "443", 10);
  const insecure = env?.ANTIGRAVITY_GRPC_INSECURE === "1";

  const requestBuf = encodeGenerateContentRequest(body);
  const frame = Buffer.alloc(5 + requestBuf.length);
  frame.writeUInt32BE(requestBuf.length, 1);
  requestBuf.copy(frame, 5);

  let tlsSocket = null;
  const client = insecure
    ? http2.connect(`http://${grpcHost}:${grpcPort}`)
    : await createTunneledTlsSocket({
        host: grpcHost,
        port: grpcPort,
        proxyUrl,
        alpnProtocols: ["h2"],
        timeoutMs: 15000,
      }).then((sock) => {
        tlsSocket = sock;
        return http2.connect(`https://${grpcHost}`, {
          createConnection: () => sock,
        });
      });

  if (tlsSocket && typeof tlsSocket.setKeepAlive === "function") {
    try { tlsSocket.setKeepAlive(true, 10000); } catch {}
  }

  let idleTimer = null;
  let pingTimer = null;
  const resetIdleTimer = (ms) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const timeoutErr = new Error(`gRPC 生图流空闲超时 (${Math.round(ms / 1000)}s 无响应数据)`);
      try { reqRef?.destroy(timeoutErr); } catch {}
      try { client.destroy(timeoutErr); } catch {}
      if (tlsSocket && !tlsSocket.destroyed) {
        try { tlsSocket.destroy(timeoutErr); } catch {}
      }
    }, ms);
    if (typeof idleTimer.unref === "function") idleTimer.unref();
  };

  let reqRef = null;
  try {
    if (!insecure) {
      pingTimer = setInterval(() => {
        if (!client.destroyed && !client.closed) {
          try { client.ping(() => {}); } catch {}
        }
      }, 10000);
      if (typeof pingTimer.unref === "function") pingTimer.unref();
    }

    const rpcPath = insecure ? GENERATE_PATH : STREAM_GENERATE_PATH;
    const req = client.request({
      ":method": "POST",
      ":path": rpcPath,
      "content-type": "application/grpc",
      "grpc-accept-encoding": "gzip",
      te: "trailers",
      authorization: `Bearer ${accessToken}`,
      "user-agent": UPSTREAM_USER_AGENT,
      "x-client-name": "antigravity",
      "x-client-version": ANTIGRAVITY_VERSION,
    });
    reqRef = req;
    resetIdleTimer(Math.min(timeoutMs, 120000));

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

    let b64 = null;
    let mimeType = "image/png";
    let finishReason = null;
    let finishMessage = null;
    let remainingCredits = null;
    const textParts = [];

    for await (const payload of readGrpcFrames(req, {
      onProgress,
      respEncoding: String(respHeaders["grpc-encoding"] || ""),
    })) {
      const decoded = decodeGenerateContentResponse(payload);
      if (decoded.remainingCredits != null) remainingCredits = decoded.remainingCredits;
      const candidates = decoded?.response?.candidates || [];
      for (const cand of candidates) {
        if (cand.finishReason) finishReason = cand.finishReason;
        if (cand.finishMessage) finishMessage = cand.finishMessage;
        for (const part of cand?.content?.parts || []) {
          if (part.inlineData?.data) {
            b64 = part.inlineData.data;
            if (part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
          } else if (part.text && !part.thought) {
            textParts.push(part.text);
          }
        }
      }
    }

    await trailerPromise;
    const status = String(trailers["grpc-status"] ?? respHeaders["grpc-status"] ?? "0");
    if (status && status !== "0") {
      const rawMsg = trailers["grpc-message"] || respHeaders["grpc-message"] || "";
      let decodedMsg = rawMsg;
      try {
        decodedMsg = decodeURIComponent(rawMsg);
      } catch {}
      const hint = GRPC_STATUS_HINTS[status] ? ` [${GRPC_STATUS_HINTS[status]}]` : "";
      const err = new Error(`Antigravity gRPC 错误 (status=${status})${hint}: ${decodedMsg}`);
      err.grpcStatus = status;
      throw err;
    }

    if (!b64) {
      const detail = [
        finishReason && finishReason !== "STOP" ? `finishReason=${finishReason}` : "",
        finishMessage || "",
        textParts.join(" ").trim(),
      ]
        .filter(Boolean)
        .join(" | ");
      throw new Error(`Antigravity 响应未包含图片数据${detail ? ` (${detail})` : ""}`);
    }

    return { b64, mimeType, remainingCredits };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (pingTimer) clearInterval(pingTimer);
    try { client.destroy(); } catch {}
    if (tlsSocket && !tlsSocket.destroyed) {
      try { tlsSocket.destroy(); } catch {}
    }
  }
}
