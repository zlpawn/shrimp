// Pure config validation for Remote Session.

import { RemoteSessionError } from "./errors.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizePeer(input = {}) {
  const src = isObject(input) ? input : {};
  const id = String(src.id || "").trim();
  const name = String(src.name || src.displayName || id || "Remote Peer").trim();

  const transport = {
    type: src.transport?.type || src.channelType || "frp",
    frpProxyName: String(src.transport?.frpProxyName || src.frpProxyName || "").trim(),
    host: String(src.transport?.host || src.host || "127.0.0.1").trim(),
    port: Number(src.transport?.port || src.port || 0),
  };

  const auth = {
    type: src.auth?.type || src.authType || "ssh",
    ssh: {
      username: String(src.auth?.ssh?.username || src.ssh?.username || "root").trim(),
      authType: src.auth?.ssh?.authType || "password",
      password: String(src.auth?.ssh?.password || src.ssh?.password || ""),
      privateKeyPath: String(src.auth?.ssh?.privateKeyPath || src.ssh?.privateKeyPath || "").trim(),
    },
    gatewayToken: String(src.auth?.gatewayToken || src.gatewayToken || "").trim(),
  };

  return {
    id: id || `peer_${Date.now()}`,
    name,
    displayName: name,
    transport,
    auth,
    services: src.services || {
      gatewayApi: src.services?.gatewayApi || `127.0.0.1:${transport.port || 18788}`,
    },
    status: src.status || "untested",
    lastCheck: src.lastCheck || null,
  };
}

export function defaultRemoteSessionConfig() {
  return {
    enabled: false,
    peers: [],
  };
}

export function normalizeRemoteSessionConfig(input = {}) {
  const src = isObject(input) ? input : {};
  const rawPeers = Array.isArray(src.peers) ? src.peers : [];
  return {
    enabled: asBool(src.enabled, false),
    peers: rawPeers.map(normalizePeer),
  };
}

export function validateRemoteSessionConfig(
  input = {},
  { natTraversalEnabled = false } = {},
) {
  const cfg = normalizeRemoteSessionConfig(input);
  if (cfg.enabled && !natTraversalEnabled) {
    throw new RemoteSessionError(
      "dependency_disabled",
      "remoteSession.enabled requires natTraversal.enabled = true",
    );
  }
  return cfg;
}

export function publicRemoteSessionConfigView(config = {}) {
  const normalized = normalizeRemoteSessionConfig(config);
  return {
    ...normalized,
    peers: normalized.peers.map((peer) => ({
      ...peer,
      auth: {
        ...peer.auth,
        ssh: {
          ...peer.auth?.ssh,
          password: peer.auth?.ssh?.password ? "******" : "",
        },
        gatewayToken: peer.auth?.gatewayToken ? "******" : "",
      },
    })),
  };
}
