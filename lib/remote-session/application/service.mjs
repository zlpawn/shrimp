// Application service: sole orchestration entry for Remote Session.

import {
  defaultRemoteSessionConfig,
  normalizeRemoteSessionConfig,
  publicRemoteSessionConfigView,
  validateRemoteSessionConfig,
} from "../domain/config-schema.mjs";
import { RemoteSessionError } from "../domain/errors.mjs";
import {
  assertControllerAction,
  createSessionRecord,
  transition,
} from "../domain/session.mjs";
import { encodeMessage } from "../domain/protocol.mjs";
import { createMemoryEventLog } from "../transport/event-log.mjs";
import { createFakeHostBackend } from "../host-attach/fake-host.mjs";
import { createLocalHostBackend } from "../host-attach/local-host.mjs";
import {
  createPeerClient,
  createPeerHostProxy,
} from "../transport/peer-client.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEndpointBase(endpoint) {
  const raw = String(endpoint || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  return ("http://" + raw).replace(/\/$/, "");
}

export function createRemoteSessionService({
  configStore,
  natTraversal,
  hostBackendFactory = null,
  eventLogFactory = createMemoryEventLog,
  idFactory = null,
  clock = () => Date.now(),
  logger = console,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!configStore) throw new Error("configStore is required");
  if (!natTraversal) throw new Error("natTraversal is required");

  let seq = 0;
  const sessions = new Map();
  const logs = new Map();
  const hosts = new Map();

  function nextId(prefix) {
    if (typeof idFactory === "function") return String(idFactory(prefix));
    seq += 1;
    return prefix + "_" + seq;
  }

  function getConfig() {
    const raw = configStore.get?.() || defaultRemoteSessionConfig();
    return normalizeRemoteSessionConfig(raw);
  }

  async function isNatEnabled() {
    if (typeof natTraversal.isEnabled === "function") {
      return Boolean(await natTraversal.isEnabled());
    }
    if (typeof natTraversal.getPublicConfig === "function") {
      const cfg = await natTraversal.getPublicConfig();
      return Boolean(cfg?.enabled);
    }
    if (typeof natTraversal.capabilities === "function") {
      const caps = await natTraversal.capabilities();
      return Boolean(caps?.enabled);
    }
    return false;
  }

  async function requireEnabled() {
    const cfg = getConfig();
    const natEnabled = await isNatEnabled();
    validateRemoteSessionConfig(cfg, { natTraversalEnabled: natEnabled });
    if (!cfg.enabled) {
      throw new RemoteSessionError("not_enabled", "remoteSession is not enabled");
    }
    return cfg;
  }

  async function getPublicConfig() {
    return publicRemoteSessionConfigView(getConfig());
  }

  async function updateConfig(patch = {}) {
    const current = getConfig();
    const merged = normalizeRemoteSessionConfig({
      ...current,
      ...(isObject(patch) ? patch : {}),
    });
    const natEnabled = await isNatEnabled();
    const validated = validateRemoteSessionConfig(merged, {
      natTraversalEnabled: natEnabled,
    });
    configStore.save(validated);
    return getPublicConfig();
  }

  function getSessionOrThrow(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new RemoteSessionError("session_not_found", "session not found: " + sessionId);
    }
    return session;
  }

  function getLog(sessionId) {
    let log = logs.get(sessionId);
    if (!log) {
      log = eventLogFactory();
      logs.set(sessionId, log);
    }
    return log;
  }

  function appendSessionEvent(session, event) {
    const log = getLog(session.id);
    const record = log.append({
      ...event,
      sessionId: session.id,
      ts: Number(event.ts) || clock(),
    });
    session.lastEventAt = record.ts;
    return record;
  }

  async function resolveHostForPeer(peerId) {
    if (hosts.has(peerId)) return hosts.get(peerId);

    let host;
    if (typeof hostBackendFactory === "function") {
      host = await hostBackendFactory({ peerId, natTraversal, logger });
    } else if (peerId === "local-host" || peerId === "fake-host") {
      host =
        peerId === "fake-host"
          ? createFakeHostBackend({ id: "fake-host" })
          : createLocalHostBackend({ id: "local-host", logger });
    } else {
      if (
        typeof natTraversal.ensureLink !== "function" ||
        typeof natTraversal.openService !== "function"
      ) {
        throw new RemoteSessionError(
          "unsupported_feature",
          "natTraversal ensureLink/openService is required for remote peers",
        );
      }
      await natTraversal.ensureLink(peerId);
      const opened = await natTraversal.openService(peerId, "gateway-api");
      const baseUrl = normalizeEndpointBase(opened?.endpoint);
      if (!baseUrl) {
        throw new RemoteSessionError(
          "invalid_config",
          "peer '" + peerId + "' has no gateway-api endpoint",
        );
      }
      host = createPeerHostProxy(createPeerClient({ baseUrl, fetchImpl }));
    }

    hosts.set(peerId, host);
    return host;
  }

  async function status() {
    const cfg = getConfig();
    return {
      enabled: Boolean(cfg.enabled),
      natTraversalEnabled: await isNatEnabled(),
      sessions: [...sessions.values()].map((session) => ({
        ...session,
        latestSeq: getLog(session.id).latestSeq(),
      })),
    };
  }

  async function listPeers() {
    if (typeof natTraversal.listPeers === "function") {
      const peers = await natTraversal.listPeers();
      return [
        { id: "local-host", displayName: "Local Host" },
        ...(Array.isArray(peers) ? peers : []),
      ];
    }
    return [{ id: "local-host", displayName: "Local Host" }];
  }

  async function listProjects(peerId = "local-host") {
    await requireEnabled();
    const host = await resolveHostForPeer(peerId);
    await host.attach();
    return host.listProjects();
  }

  async function openSession({
    peerId = "local-host",
    projectId,
    controllerPeerId = "controller",
  } = {}) {
    await requireEnabled();
    if (!projectId) {
      throw new RemoteSessionError("invalid_request", "projectId is required");
    }
    if (!controllerPeerId) {
      throw new RemoteSessionError("invalid_request", "controllerPeerId is required");
    }

    if (peerId !== "local-host" && peerId !== "fake-host") {
      await natTraversal.ensureLink(peerId);
    }

    const host = await resolveHostForPeer(peerId);
    await host.attach();
    const created = await host.createConversation(projectId);
    const session = createSessionRecord({
      id: nextId("rs"),
      controllerPeerId,
      hostPeerId: peerId,
      hostProjectId: projectId,
      hostConversationId: created.conversationId,
      state: "ready",
      createdAt: clock(),
      lastEventAt: clock(),
    });
    sessions.set(session.id, session);
    getLog(session.id);
    appendSessionEvent(session, {
      type: "session_opened",
      message: encodeMessage("CREATE_SESSION", {
        sessionId: session.id,
        projectId,
        conversationId: created.conversationId,
      }),
    });
    return { ...session };
  }

  async function dispatchPrompt({
    sessionId,
    prompt,
    controllerPeerId,
  } = {}) {
    await requireEnabled();
    const session = getSessionOrThrow(sessionId);
    assertControllerAction(session, controllerPeerId, "DISPATCH_PROMPT");
    if (!prompt) {
      throw new RemoteSessionError("invalid_request", "prompt is required");
    }

    const host = await resolveHostForPeer(session.hostPeerId);
    Object.assign(session, transition(session, "running", { at: clock() }));
    sessions.set(session.id, session);

    const result = await host.dispatchPrompt({
      conversationId: session.hostConversationId,
      prompt,
      controllerPeerId,
    });

    const emitted = [];
    for (const event of result.events || []) {
      const record = appendSessionEvent(session, {
        type: event.type,
        turnId: result.turnId,
        hostEvent: event,
      });
      emitted.push(record);
      if (event.type === "approval_required") {
        Object.assign(session, transition(session, "awaiting_approval", { at: clock() }));
        sessions.set(session.id, session);
        appendSessionEvent(session, {
          type: "approval_required",
          approvalId: event.approvalId,
          summary: event.summary || "",
          turnId: result.turnId,
        });
      }
      if (event.type === "turn_completed" && session.state !== "awaiting_approval") {
        Object.assign(session, transition(session, "ready", { at: clock() }));
        sessions.set(session.id, session);
      }
    }

    return {
      session: { ...session },
      turnId: result.turnId,
      events: emitted,
    };
  }

  async function listEvents({ sessionId, cursor = 0 } = {}) {
    const session = getSessionOrThrow(sessionId);
    return {
      sessionId: session.id,
      events: getLog(session.id).list(cursor),
      latestSeq: getLog(session.id).latestSeq(),
    };
  }

  async function* subscribe({ sessionId, cursor = 0 } = {}) {
    const listed = await listEvents({ sessionId, cursor });
    for (const event of listed.events) {
      yield event;
    }
  }

  async function decideApproval({
    sessionId,
    approvalId,
    decision,
    controllerPeerId,
  } = {}) {
    await requireEnabled();
    const session = getSessionOrThrow(sessionId);
    assertControllerAction(session, controllerPeerId, "APPROVAL_DECISION");
    if (!approvalId) {
      throw new RemoteSessionError("invalid_request", "approvalId is required");
    }

    const host = await resolveHostForPeer(session.hostPeerId);
    const result = await host.decideApproval({
      conversationId: session.hostConversationId,
      approvalId,
      decision,
      controllerPeerId,
    });

    appendSessionEvent(session, {
      type: "approval_decision",
      approvalId,
      decision,
      hostEvent: result?.event || null,
    });

    Object.assign(session, transition(session, "ready", { at: clock() }));
    sessions.set(session.id, session);
    return {
      session: { ...session },
      result,
    };
  }

  async function markDisconnected({ sessionId } = {}) {
    const session = getSessionOrThrow(sessionId);
    if (session.state === "ended") return { ...session };
    Object.assign(session, transition(session, "disconnected", { at: clock() }));
    sessions.set(session.id, session);
    appendSessionEvent(session, { type: "controller_disconnected" });
    return { ...session };
  }

  async function resumeSession({
    sessionId,
    controllerPeerId,
    cursor = 0,
  } = {}) {
    await requireEnabled();
    const session = getSessionOrThrow(sessionId);
    assertControllerAction(session, controllerPeerId, "RESUME_SESSION");

    if (session.state === "disconnected") {
      Object.assign(session, transition(session, "ready", { at: clock() }));
      sessions.set(session.id, session);
    }

    const events = getLog(session.id).list(cursor);
    appendSessionEvent(session, {
      type: "session_resumed",
      cursor: Number(cursor || 0),
    });

    return {
      session: { ...session },
      events,
      latestSeq: getLog(session.id).latestSeq(),
    };
  }

  async function endSession({
    sessionId,
    controllerPeerId,
  } = {}) {
    await requireEnabled();
    const session = getSessionOrThrow(sessionId);
    assertControllerAction(session, controllerPeerId, "SESSION_END");
    Object.assign(session, transition(session, "ended", { at: clock() }));
    sessions.set(session.id, session);
    appendSessionEvent(session, { type: "session_ended" });
    return { ...session };
  }

  async function getSession(sessionId) {
    const session = getSessionOrThrow(sessionId);
    return {
      ...session,
      latestSeq: getLog(session.id).latestSeq(),
    };
  }

  return {
    getPublicConfig,
    updateConfig,
    status,
    listPeers,
    listProjects,
    openSession,
    getSession,
    dispatchPrompt,
    listEvents,
    subscribe,
    decideApproval,
    markDisconnected,
    resumeSession,
    endSession,
  };
}
