import path from "node:path";

const SESSION_ID_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

export function generateManifest(hubStore) {
  if (!hubStore || typeof hubStore.listSessions !== "function") {
    return { sessions: [] };
  }
  const sessions = hubStore.listSessions();
  return {
    sessions: sessions.map((s) => ({
      session_id: s.session_id,
      source_app: s.source_app || "unknown",
      workspace_path: s.workspace_path || "",
      created_at: s.created_at || "",
      updated_at: s.updated_at || "",
      summary: s.summary || "",
      message_count: Array.isArray(s.messages) ? s.messages.length : 0,
    })),
  };
}

export function validateSessionId(sessionId) {
  const clean = String(sessionId || "").trim();
  if (
    !clean ||
    !SESSION_ID_REGEX.test(clean) ||
    clean.includes("..") ||
    clean.includes("/") ||
    clean.includes("\\")
  ) {
    throw new Error("invalid_session_id: Path traversal or invalid characters detected");
  }
  return clean;
}

export function getSessionSafely(hubStore, sessionId) {
  const cleanId = validateSessionId(sessionId);
  const session = hubStore.getSession(cleanId);
  if (!session) return null;

  if (session._filePath && hubStore.sessionsDir) {
    const resolvedPath = path.resolve(session._filePath);
    const expectedDir = path.resolve(hubStore.sessionsDir);
    if (!resolvedPath.startsWith(expectedDir)) {
      throw new Error("security_violation: session file escapes hub storage directory");
    }
  }
  return session;
}

export function mergeSessionLWW(hubStore, incomingSession) {
  if (!incomingSession || !incomingSession.session_id) {
    throw new Error("invalid_session_data: session_id is required");
  }
  const cleanId = validateSessionId(incomingSession.session_id);
  incomingSession.session_id = cleanId;

  const existing = hubStore.getSession(cleanId);
  if (!existing) {
    hubStore.saveSession(incomingSession);
    return { updated: true, action: "created" };
  }

  const existingTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
  const incomingTime = new Date(incomingSession.updated_at || incomingSession.created_at || 0).getTime();

  if (incomingTime >= existingTime) {
    hubStore.saveSession(incomingSession);
    return { updated: true, action: "overwritten" };
  }

  return {
    updated: false,
    action: "kept_local",
    reason: "local is newer",
    localUpdatedAt: existing.updated_at,
    incomingUpdatedAt: incomingSession.updated_at,
  };
}

export function verifySyncAuth(req, { expectedKey = "", peerTokens = [] } = {}) {
  const authHeader = String(req?.headers?.authorization || req?.headers?.Authorization || "").trim();
  const apiKeyHeader = String(req?.headers?.["x-api-key"] || req?.headers?.["X-Api-Key"] || "").trim();

  let token = "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    token = apiKeyHeader;
  }

  const validTokens = new Set();
  if (expectedKey) validTokens.add(expectedKey);
  for (const t of peerTokens) {
    if (t) validTokens.add(t);
  }

  if (validTokens.size === 0) {
    // If no keys configured, allow localhost only
    const remoteIp = req?.socket?.remoteAddress || "";
    if (remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1") {
      return true;
    }
    return false;
  }

  return token ? validTokens.has(token) : false;
}

export async function syncWithPeer({
  peerClient,
  hubStore,
  direction = "pull",
} = {}) {
  if (!peerClient || typeof peerClient.request !== "function") {
    throw new Error("peerClient is required");
  }
  if (!hubStore) {
    throw new Error("hubStore is required");
  }

  if (direction === "pull") {
    const manifest = await peerClient.request("GET", "/v1/session-sync/manifest");
    const remoteList = Array.isArray(manifest?.sessions) ? manifest.sessions : [];
    let pulled = 0;
    let skipped = 0;

    for (const remote of remoteList) {
      if (!remote?.session_id) continue;
      const existing = hubStore.getSession(remote.session_id);
      const existingTime = existing ? new Date(existing.updated_at || 0).getTime() : 0;
      const remoteTime = new Date(remote.updated_at || 0).getTime();

      if (!existing || remoteTime > existingTime) {
        const full = await peerClient.request(
          "GET",
          `/v1/session-sync/file/${encodeURIComponent(remote.session_id)}`,
        );
        if (full) {
          mergeSessionLWW(hubStore, full);
          pulled++;
        }
      } else {
        skipped++;
      }
    }
    return { direction: "pull", pulled, skipped, total: remoteList.length };
  }

  if (direction === "push") {
    const localList = hubStore.listSessions();
    const manifest = await peerClient.request("GET", "/v1/session-sync/manifest").catch(() => ({ sessions: [] }));
    const remoteMap = new Map();
    for (const s of manifest?.sessions || []) {
      if (s.session_id) remoteMap.set(s.session_id, new Date(s.updated_at || 0).getTime());
    }

    let pushed = 0;
    let skipped = 0;

    for (const local of localList) {
      const localTime = new Date(local.updated_at || 0).getTime();
      const remoteTime = remoteMap.get(local.session_id) || 0;
      if (localTime >= remoteTime) {
        await peerClient.request("POST", "/v1/session-sync/push", local);
        pushed++;
      } else {
        skipped++;
      }
    }
    return { direction: "push", pushed, skipped, total: localList.length };
  }

  throw new Error("unsupported_direction: only pull or push is supported");
}
