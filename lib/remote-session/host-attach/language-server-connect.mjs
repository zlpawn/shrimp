// Connect-JSON client for Antigravity language_server.
// Live list/inspect are solid; create/dispatch are experimental and model-gated.

import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";

import { RemoteSessionError } from "../domain/errors.mjs";
import {
  defaultAntigravityPaths,
  discoverDynamicLocalEndpoint,
} from "./project-store.mjs";

const SERVICE = "exa.language_server_pb.LanguageServerService";
export const LANGUAGE_SERVER_SERVICE = SERVICE;
export const CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT =
  "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT";
export const CORTEX_TRAJECTORY_TYPE_CASCADE = "CORTEX_TRAJECTORY_TYPE_CASCADE";

function normalizeBaseUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return raw.replace(/\/$/, "");
}

function createAgent(baseUrl) {
  if (String(baseUrl).startsWith("https:")) {
    return new https.Agent({ rejectUnauthorized: false });
  }
  return undefined;
}

async function fetchText(
  url,
  { method = "GET", headers = {}, body = null, timeoutMs = 8000, agent = undefined } = {},
) {
  const lib = String(url).startsWith("https:") ? https : http;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    if (body != null) req.write(body);
    req.end();
  });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function extractTextFromItems(items) {
  if (!Array.isArray(items)) return "";
  const parts = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const text = firstNonEmpty(
      item.text,
      item.content,
      item.markdown,
      item.message,
      item.value,
    );
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

function extractUserTextFromStep(step) {
  const userInput = step?.userInput || step?.payload?.userInput || null;
  const text = firstNonEmpty(
    userInput?.userResponse,
    userInput?.text,
    userInput?.content,
    extractTextFromItems(userInput?.items),
    step?.content,
    step?.text,
  );
  if (!text) return "";
  const match = String(text).match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  return match ? match[1].trim() : text;
}

function extractAssistantTextFromStep(step) {
  const planner =
    step?.plannerResponse ||
    step?.payload?.plannerResponse ||
    step?.response ||
    null;
  return firstNonEmpty(
    planner?.modifiedResponse,
    planner?.response,
    planner?.text,
    planner?.content,
    planner?.message,
    extractTextFromItems(planner?.items),
    extractTextFromItems(step?.items),
    step?.content,
    step?.text,
    planner?.thinking,
    step?.thinking,
  );
}

function mapStepToEvent(step, index) {
  const typeName = String(step?.type || "");
  const source = String(step?.metadata?.source || step?.source || "");
  let type = "host_step";
  let text = "";
  if (/USER_INPUT/i.test(typeName) || /USER_EXPLICIT/i.test(source)) {
    type = "user_text";
    text = extractUserTextFromStep(step);
  } else if (/PLANNER_RESPONSE|MODEL_RESPONSE|ASSISTANT/i.test(typeName)) {
    type = "assistant_text";
    text = extractAssistantTextFromStep(step);
  } else if (/CHECKPOINT/i.test(typeName)) {
    type = "checkpoint";
    text = String(step?.content || step?.text || "checkpoint");
  } else if (/ERROR/i.test(typeName)) {
    type = "error";
    text = firstNonEmpty(
      step?.errorMessage?.error?.shortError,
      step?.errorMessage?.error?.userErrorMessage,
      step?.errorMessage?.error?.fullError,
      step?.content,
      typeName,
    );
  } else {
    text = String(step?.content || step?.text || typeName || "");
  }
  return {
    seq: index + 1,
    type,
    hostType: typeName,
    source,
    status: String(step?.status || ""),
    createdAt: step?.metadata?.createdAt || step?.createdAt || null,
    text,
    thinking: step?.thinking || step?.plannerResponse?.thinking || "",
    raw: step,
  };
}

export function toFileUri(workspacePath = "") {
  const raw = String(workspacePath || "").trim();
  if (!raw) return "";
  if (raw.startsWith("file:")) return raw;
  let normalized = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    if (!normalized.startsWith("/")) normalized = "/" + normalized;
  } else if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }
  return "file://" + encodeURI(normalized);
}

export function buildTextScopeItem(text) {
  return {
    chunk: {
      case: "text",
      value: String(text || ""),
    },
  };
}

export function buildRequestedModelAlias(alias = "AUTO") {
  return {
    choice: {
      case: "alias",
      value: String(alias || "AUTO"),
    },
  };
}

export function buildCascadeConfig({
  requestedModel = buildRequestedModelAlias("AUTO"),
  agenticMode = true,
  plannerMode = "DEFAULT",
} = {}) {
  return {
    plannerConfig: {
      requestedModel,
      plannerTypeConfig: {
        case: "conversational",
        value: {
          plannerMode,
          agenticMode: Boolean(agenticMode),
        },
      },
    },
  };
}

export function buildStartCascadeRequest({
  cascadeId = crypto.randomUUID(),
  workspacePath = "",
  workspaceUri = "",
  source = CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT,
  trajectoryType = CORTEX_TRAJECTORY_TYPE_CASCADE,
  requestedModel = null,
} = {}) {
  const uri = workspaceUri || toFileUri(workspacePath);
  const body = {
    cascadeId,
    source,
    trajectoryType,
  };
  if (uri) body.workspaceUris = [uri];
  if (requestedModel) body.requestedModel = requestedModel;
  return body;
}

export function buildSendUserCascadeMessageRequest({
  cascadeId,
  prompt,
  cascadeConfig = null,
  requestedModel = null,
} = {}) {
  const body = {
    cascadeId,
    items: [buildTextScopeItem(prompt)],
  };
  if (cascadeConfig) {
    body.cascadeConfig = cascadeConfig;
  } else if (requestedModel) {
    body.cascadeConfig = buildCascadeConfig({ requestedModel });
  }
  return body;
}

export function createLanguageServerConnectClient({
  baseUrl = "",
  csrfToken = "",
  service = SERVICE,
  timeoutMs = 8000,
  fetchImpl = null,
} = {}) {
  const root = normalizeBaseUrl(baseUrl);
  if (!root) {
    throw new RemoteSessionError("invalid_request", "language server baseUrl is required");
  }
  const agent = createAgent(root);

  async function request(methodName, body = {}) {
    const url = `${root}/${service}/${methodName}`;
    const payload = JSON.stringify(body || {});
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      "connect-protocol-version": "1",
      "content-length": Buffer.byteLength(payload),
    };
    if (csrfToken) headers["x-codeium-csrf-token"] = csrfToken;

    let res;
    try {
      if (typeof fetchImpl === "function") {
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: payload,
        });
        const text = await response.text();
        res = {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries?.() || []),
          body: text,
        };
      } else {
        res = await fetchText(url, {
          method: "POST",
          headers,
          body: payload,
          timeoutMs,
          agent,
        });
      }
    } catch (error) {
      throw new RemoteSessionError(
        "protocol_error",
        `language server request failed: ${methodName}: ${error?.message || error}`,
        { methodName, url },
      );
    }

    let json = null;
    if (res.body) {
      try {
        json = JSON.parse(res.body);
      } catch {
        json = null;
      }
    }

    if (res.status < 200 || res.status >= 300) {
      throw new RemoteSessionError(
        "protocol_error",
        (json && json.message) ||
          `language server ${methodName} failed with HTTP ${res.status}`,
        {
          methodName,
          status: res.status,
          code: json?.code || null,
          body: json || res.body?.slice?.(0, 300) || null,
        },
      );
    }
    return json || {};
  }

  return {
    baseUrl: root,
    csrfToken,
    service,
    request,
    async getAllCascadeTrajectories() {
      return request("GetAllCascadeTrajectories", {});
    },
    async getCascadeTrajectory(cascadeId, extra = {}) {
      return request("GetCascadeTrajectory", {
        cascadeId,
        ...extra,
      });
    },
    async getCascadeTrajectorySteps(cascadeId, extra = {}) {
      return request("GetCascadeTrajectorySteps", {
        cascadeId,
        stepOffset: 0,
        ...extra,
      });
    },
    async searchConversations(query = "") {
      return request("SearchConversations", { query: String(query || "") });
    },
    async getUserStatus() {
      return request("GetUserStatus", {});
    },
    async startCascade(body = {}) {
      return request("StartCascade", body);
    },
    async sendUserCascadeMessage(body = {}) {
      return request("SendUserCascadeMessage", body);
    },
  };
}

export async function discoverLanguageServerConnectEndpoint({
  paths = defaultAntigravityPaths(),
  discoverEndpointImpl = discoverDynamicLocalEndpoint,
  fetchHtmlImpl = null,
  timeoutMs = 5000,
} = {}) {
  const endpoint = discoverEndpointImpl({
    mainLogPath: paths.mainLogPath,
  });
  const baseUrl = normalizeBaseUrl(endpoint?.url || "");
  if (!baseUrl) {
    return {
      ok: false,
      reason: "endpoint_not_found",
      endpoint,
      csrfToken: "",
      baseUrl: "",
    };
  }

  let csrfToken = endpoint.csrfToken || "";
  try {
    let html = "";
    if (typeof fetchHtmlImpl === "function") {
      html = await fetchHtmlImpl(baseUrl + "/");
    } else {
      const agent = createAgent(baseUrl);
      const res = await fetchText(baseUrl + "/", {
        method: "GET",
        timeoutMs,
        agent,
      });
      html = res.body || "";
    }
    const match = String(html).match(/csrfToken":"([^"]+)/);
    if (match?.[1]) csrfToken = match[1];
  } catch {
    // keep log csrf if html fetch fails
  }

  return {
    ok: Boolean(baseUrl && csrfToken),
    reason: baseUrl ? (csrfToken ? "ok" : "csrf_missing") : "endpoint_not_found",
    endpoint,
    csrfToken,
    baseUrl,
  };
}

export function summarizeTrajectoryList(payload = {}) {
  const summaries = payload?.trajectorySummaries || {};
  const items = Object.entries(summaries).map(([cascadeId, summary]) => {
    const s = summary || {};
    return {
      id: cascadeId,
      cascadeId,
      conversationId: cascadeId,
      trajectoryId: String(s.trajectoryId || ""),
      title: String(s.summary || `conversation ${cascadeId.slice(0, 8)}`),
      preview: String(s.summary || ""),
      status: String(s.status || ""),
      stepCount: Number(s.stepCount || 0),
      createdAt: s.createdTime || null,
      updatedAt: s.lastModifiedTime || null,
      source: "language-server-connect",
    };
  });
  items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return items;
}

export function summarizeTrajectoryDetail(payload = {}, { cascadeId = "" } = {}) {
  const trajectory = payload?.trajectory || {};
  const id = String(trajectory.cascadeId || cascadeId || "");
  const steps = Array.isArray(trajectory.steps) ? trajectory.steps : [];
  const events = steps.map((step, index) => mapStepToEvent(step, index));
  const userEvent = events.find((event) => event.type === "user_text");
  const assistantEvent = [...events]
    .reverse()
    .find((event) => event.type === "assistant_text");
  return {
    id,
    cascadeId: id,
    conversationId: id,
    trajectoryId: String(trajectory.trajectoryId || ""),
    title:
      String(userEvent?.text || "").slice(0, 120) ||
      `conversation ${id.slice(0, 8)}`,
    preview: String(userEvent?.text || "").slice(0, 200),
    status: String(payload?.status || trajectory.status || "unknown"),
    mode: "live_readonly",
    stepCount: Number(payload?.numTotalSteps || steps.length || 0),
    eventCount: events.length,
    latestSeq: events.length,
    pendingApprovals: [],
    events,
    transcript: events.map((event) => ({
      stepIndex: event.seq - 1,
      type: event.hostType,
      source: event.source,
      status: event.status,
      createdAt: event.createdAt,
      content: event.text,
    })),
    assistantPreview: String(assistantEvent?.text || "").slice(0, 240),
    source: "language-server-connect",
    rawStatus: payload?.status || null,
  };
}
