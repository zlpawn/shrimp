// Peer gateway client for dual-machine path.

import { RemoteSessionError } from "../domain/errors.mjs";

function normalizeBaseUrl(endpoint) {
  const raw = String(endpoint || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  return ("http://" + raw).replace(/\/$/, "");
}

export function createPeerClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  headers = {},
} = {}) {
  const root = normalizeBaseUrl(baseUrl);
  if (!root) {
    throw new RemoteSessionError("invalid_request", "peer baseUrl is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new RemoteSessionError("invalid_request", "fetchImpl is required");
  }

  async function request(method, relPath, body) {
    const url = root + (relPath.startsWith("/") ? relPath : "/" + relPath);
    const init = {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetchImpl(url, init);
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      throw new RemoteSessionError(
        "protocol_error",
        (data && data.error && data.error.message) || ("peer request failed: " + res.status),
        { status: res.status, data },
      );
    }
    return data;
  }

  return {
    baseUrl: root,
    listProjects() {
      return request("GET", "/v1/remote-session/host/projects");
    },
    attach() {
      return request("POST", "/v1/remote-session/host/attach", {});
    },
    createConversation(projectId) {
      return request("POST", "/v1/remote-session/host/conversations", { projectId });
    },
    dispatchPrompt({ conversationId, prompt, controllerPeerId }) {
      return request(
        "POST",
        "/v1/remote-session/host/conversations/" + encodeURIComponent(conversationId) + "/prompt",
        { prompt, controllerPeerId },
      );
    },
    listEvents({ conversationId, cursor = 0 }) {
      return request(
        "GET",
        "/v1/remote-session/host/conversations/" +
          encodeURIComponent(conversationId) +
          "/events?cursor=" +
          Number(cursor || 0),
      );
    },
    decideApproval({ conversationId, approvalId, decision, controllerPeerId }) {
      return request(
        "POST",
        "/v1/remote-session/host/conversations/" +
          encodeURIComponent(conversationId) +
          "/approvals/" +
          encodeURIComponent(approvalId),
        { decision, controllerPeerId },
      );
    },
  };
}

export function createPeerHostProxy(client) {
  return {
    id: "peer-host",
    capabilities() {
      return ["peer-proxy"];
    },
    async isRunning() {
      return true;
    },
    async attach() {
      return client.attach();
    },
    async listProjects() {
      const data = await client.listProjects();
      return data.projects || data || [];
    },
    async createConversation(projectId) {
      return client.createConversation(projectId);
    },
    async dispatchPrompt(args) {
      return client.dispatchPrompt(args);
    },
    async subscribeEvents({ conversationId, cursor = 0 }) {
      const data = await client.listEvents({ conversationId, cursor });
      const events = data.events || [];
      async function* iterator() {
        for (const event of events) yield event;
      }
      return iterator();
    },
    async listPendingApprovals() {
      return [];
    },
    async decideApproval(args) {
      return client.decideApproval(args);
    },
    async getConversation() {
      return null;
    },
  };
}
