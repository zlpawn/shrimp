// Application service: sole orchestration entry for Remote Session.

import {
  defaultRemoteSessionConfig,
  normalizePeer,
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
import { createSshHostBackend } from "../host-attach/ssh-host.mjs";
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

    let host = null;
    if (typeof hostBackendFactory === "function") {
      host = await hostBackendFactory({ peerId, natTraversal, logger });
    }
    if (!host) {
      if (peerId === "local-host" || peerId === "fake-host") {
        host =
          peerId === "fake-host"
            ? createFakeHostBackend({ id: "fake-host" })
            : createLocalHostBackend({ id: "local-host", logger });
      } else {
        const currentPeers = getConfig().peers || [];
        const targetPeer = currentPeers.find((p) => p.id === peerId);

        if (targetPeer?.auth?.type === "ssh") {
          host = createSshHostBackend({ peer: targetPeer, logger });
        } else if (
          typeof natTraversal.ensureLink === "function" &&
          typeof natTraversal.openService === "function"
        ) {
          await natTraversal.ensureLink(peerId);
          const opened = await natTraversal.openService(peerId, "gateway-api");
          const baseUrl = normalizeEndpointBase(opened?.endpoint);
          if (!baseUrl) {
            throw new RemoteSessionError(
              "invalid_config",
              "peer \"" + peerId + "\" has no gateway-api endpoint",
            );
          }
          host = createPeerHostProxy(createPeerClient({ baseUrl, fetchImpl }));
        } else {
          throw new RemoteSessionError(
            "unsupported_feature",
            "natTraversal ensureLink/openService is required for remote peers",
          );
        }
      }
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
    const cfg = getConfig();
    const remotePeers = Array.isArray(cfg.peers) && cfg.peers.length > 0 ? cfg.peers : [];
    if (!remotePeers.length && typeof natTraversal.listPeers === "function") {
      try {
        const natPeers = await natTraversal.listPeers();
        if (Array.isArray(natPeers)) {
          return [
            { id: "local-host", name: "Local Host", displayName: "Local Host", status: "online" },
            ...natPeers.map(normalizePeer),
          ];
        }
      } catch {
        // ignore
      }
    }
    return [
      { id: "local-host", name: "Local Host", displayName: "Local Host", status: "online" },
      ...remotePeers,
    ];
  }

  async function upsertPeer(peerPatch = {}) {
    const current = getConfig();
    const normalized = normalizePeer(peerPatch);
    const existing = current.peers || [];
    const idx = existing.findIndex((p) => p.id === normalized.id);
    let nextPeers;
    if (idx >= 0) {
      nextPeers = [...existing];
      nextPeers[idx] = { ...existing[idx], ...normalized };
    } else {
      nextPeers = [...existing, normalized];
    }
    await updateConfig({ peers: nextPeers });
    if (typeof natTraversal.upsertPeer === "function") {
      try {
        await natTraversal.upsertPeer({
          id: normalized.id,
          displayName: normalized.name,
          services: normalized.services,
        });
      } catch {
        // ignore
      }
    }
    return normalized;
  }

  async function deletePeer(peerId) {
    const current = getConfig();
    const nextPeers = (current.peers || []).filter((p) => p.id !== peerId);
    await updateConfig({ peers: nextPeers });
    if (typeof natTraversal.deletePeer === "function") {
      try {
        await natTraversal.deletePeer(peerId);
      } catch {
        // ignore
      }
    }
    return { ok: true, deleted: peerId };
  }

  async function listProjects(peerId = "local-host") {
    await requireEnabled();
    const host = await resolveHostForPeer(peerId);
    await host.attach();
    return host.listProjects();
  }

  async function listConversations(peerId = "local-host", { limit = 20 } = {}) {
    await requireEnabled();
    const host = await resolveHostForPeer(peerId);
    await host.attach();
    if (typeof host.listConversations !== "function") {
      throw new RemoteSessionError(
        "unsupported_feature",
        "host backend does not support listConversations",
        { peerId },
      );
    }
    return host.listConversations({ limit });
  }

  async function inspectConversation(peerId = "local-host", conversationId) {
    await requireEnabled();
    if (!conversationId) {
      throw new RemoteSessionError("invalid_request", "conversationId is required");
    }
    const host = await resolveHostForPeer(peerId);
    await host.attach();
    if (typeof host.getConversation !== "function") {
      throw new RemoteSessionError(
        "unsupported_feature",
        "host backend does not support getConversation",
        { peerId },
      );
    }
    return host.getConversation(conversationId);
  }

  async function openSession({
    peerId = "local-host",
    projectId,
    conversationId = null,
    controllerPeerId = "controller",
    model = null,
    modelAlias = null,
    cascadeConfig = null,
  } = {}) {
    await requireEnabled();
    if (!projectId) {
      throw new RemoteSessionError("invalid_request", "projectId is required");
    }
    if (!controllerPeerId) {
      throw new RemoteSessionError("invalid_request", "controllerPeerId is required");
    }

    if (peerId !== "local-host" && peerId !== "fake-host") {
      const currentPeers = getConfig().peers || [];
      const targetPeer = currentPeers.find((p) => p.id === peerId);
      if (targetPeer?.auth?.type !== "ssh") {
        await natTraversal.ensureLink(peerId);
      }
    }

    const host = await resolveHostForPeer(peerId);
    await host.attach();
    const created = await host.createConversation(projectId, {
      ...(conversationId ? { conversationId } : {}),
      ...(model ? { model } : {}),
      ...(modelAlias ? { modelAlias } : {}),
      ...(cascadeConfig ? { cascadeConfig } : {}),
    });
    const finalConversationId =
      conversationId || created?.conversationId || `conv_${Date.now()}`;
    const session = createSessionRecord({
      id: nextId("rs"),
      controllerPeerId,
      hostPeerId: peerId,
      hostProjectId: projectId,
      hostConversationId: finalConversationId,
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
        controllerPeerId,
        hostPeerId: peerId,
        hostProjectId: projectId,
        hostConversationId: finalConversationId,
      }),
    });
    return {
      ...session,
      hostTurnId: created.turnId || null,
      latestSeq: getLog(session.id).latestSeq(),
    };
  }

  async function dispatchPrompt({
    sessionId,
    prompt,
    controllerPeerId,
    model = null,
    modelAlias = null,
    cascadeConfig = null,
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
      ...(model ? { model } : {}),
      ...(modelAlias ? { modelAlias } : {}),
      ...(cascadeConfig ? { cascadeConfig } : {}),
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

  async function* subscribe({
    sessionId,
    cursor = 0,
    includeHostEvents = false,
  } = {}) {
    const listed = await listEvents({ sessionId, cursor });
    for (const event of listed.events) {
      yield event;
    }

    if (!includeHostEvents) return;
    const session = getSessionOrThrow(sessionId);
    const host = await resolveHostForPeer(session.hostPeerId);
    if (typeof host.subscribeEvents !== "function") {
      throw new RemoteSessionError(
        "unsupported_feature",
        "host backend does not support subscribeEvents",
        { sessionId },
      );
    }
    const hostCursor = Math.max(
      0,
      Number(session.hostEventCursor || 0),
    );
    const iterator = await host.subscribeEvents({
      conversationId: session.hostConversationId,
      cursor: hostCursor,
      intervalMs: 1000,
      timeoutMs: 0,
    });
    for await (const hostEvent of iterator) {
      const record = appendSessionEvent(session, {
        type: hostEvent.type || "host_event",
        hostEvent,
      });
      session.hostEventCursor = Math.max(
        Number(session.hostEventCursor || 0),
        Number(hostEvent.seq || 0),
      );
      sessions.set(session.id, session);
      yield record;
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

  async function listAvailableModels(peerId = "local-host") {
    const models = [];
    try {
      const host = await resolveHostForPeer(peerId);
      await host.attach();
      if (typeof host.listAvailableModels === "function") {
        const list = await host.listAvailableModels();
        for (const item of list || []) {
          if (item?.id && !models.some((m) => m.id === item.id)) {
            models.push(item);
          }
        }
      }
      if (typeof host.getAutoModel === "function" && models.length === 0) {
        const auto = await host.getAutoModel();
        if (auto?.model && !auto.model.startsWith("MODEL_PLACEHOLDER_")) {
          models.push({
            id: auto.model,
            name: `${auto.model} (Host 推荐模型)`,
            source: "host_auto",
            isRecommended: true,
          });
        }
      }
    } catch {
      // Host may be offline/unreachable
    }

    return models;
  }

  return {
    getPublicConfig,
    updateConfig,
    status,
    listPeers,
    upsertPeer,
    deletePeer,
    listProjects,
    listConversations,
    inspectConversation,
    listAvailableModels,
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
