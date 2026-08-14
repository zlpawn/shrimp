// Pure config validation for NAT Traversal.

import { NatTraversalError } from "./errors.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function defaultNatTraversalConfig() {
  return {
    enabled: false,
    activeProvider: "frpc",
    frpc: {
      binPath: "",
      configPath: "",
      serverAddr: "",
      serverPort: 7000,
      logLevel: "info",
      proxies: [],
    },
    frpsDashboard: {
      enabled: false,
      url: "",
    },
    peers: [],
  };
}

export function normalizeNatTraversalConfig(input = {}) {
  const base = defaultNatTraversalConfig();
  const src = isObject(input) ? input : {};
  const frpcIn = isObject(src.frpc) ? src.frpc : {};
  const dashIn = isObject(src.frpsDashboard) ? src.frpsDashboard : {};
  const proxies = Array.isArray(frpcIn.proxies)
    ? frpcIn.proxies.map((proxy, index) => normalizeProxy(proxy, index))
    : [];
  const peers = Array.isArray(src.peers)
    ? src.peers.map((peer, index) => normalizePeer(peer, index))
    : [];

  return {
    enabled: asBool(src.enabled, base.enabled),
    activeProvider: asString(src.activeProvider, base.activeProvider) || "frpc",
    frpc: {
      binPath: asString(frpcIn.binPath, ""),
      configPath: asString(frpcIn.configPath, ""),
      serverAddr: asString(frpcIn.serverAddr, ""),
      serverPort: asNumber(frpcIn.serverPort, 7000),
      logLevel: asString(frpcIn.logLevel, "info") || "info",
      proxies,
    },
    frpsDashboard: {
      enabled: asBool(dashIn.enabled, false),
      url: asString(dashIn.url, ""),
    },
    peers,
  };
}

function normalizeProxy(proxy, index) {
  const src = isObject(proxy) ? proxy : {};
  const name = asString(src.name, `proxy-${index + 1}`) || `proxy-${index + 1}`;
  return {
    name,
    type: asString(src.type, "tcp") || "tcp",
    localIp: asString(src.localIp, "127.0.0.1") || "127.0.0.1",
    localPort: asNumber(src.localPort, 0),
    remotePort: asNumber(src.remotePort, 0),
  };
}

function normalizePeer(peer, index) {
  const src = isObject(peer) ? peer : {};
  const ssh = isObject(src.ssh) ? src.ssh : {};
  const services = isObject(src.services) ? src.services : {};
  return {
    id: asString(src.id, `peer-${index + 1}`) || `peer-${index + 1}`,
    displayName: asString(src.displayName, "") || asString(src.id, `peer-${index + 1}`),
    ssh: {
      host: asString(ssh.host, ""),
      port: asNumber(ssh.port, 22),
      user: asString(ssh.user, ""),
      identityFile: asString(ssh.identityFile, ""),
    },
    services: {
      gatewayApi: asString(services.gatewayApi, ""),
    },
  };
}

export function validateNatTraversalConfig(config) {
  const issues = [];
  const cfg = normalizeNatTraversalConfig(config);

  if (!cfg.activeProvider) {
    issues.push("activeProvider is required");
  }
  if (cfg.activeProvider === "frpc") {
    if (!cfg.frpc.serverAddr) issues.push("frpc.serverAddr is required");
    if (!cfg.frpc.serverPort || cfg.frpc.serverPort <= 0) {
      issues.push("frpc.serverPort must be a positive number");
    }
    for (const proxy of cfg.frpc.proxies) {
      if (!proxy.name) issues.push("proxy.name is required");
      if (!proxy.localPort || proxy.localPort <= 0) {
        issues.push(`proxy '${proxy.name}' localPort must be positive`);
      }
      if (!proxy.remotePort || proxy.remotePort <= 0) {
        issues.push(`proxy '${proxy.name}' remotePort must be positive`);
      }
    }
  }

  if (cfg.frpsDashboard.enabled && !cfg.frpsDashboard.url) {
    issues.push("frpsDashboard.url is required when dashboard is enabled");
  }
  if (cfg.frpsDashboard.url) {
    try {
      // eslint-disable-next-line no-new
      new URL(cfg.frpsDashboard.url);
    } catch {
      issues.push("frpsDashboard.url must be a valid URL");
    }
  }

  const peerIds = new Set();
  for (const peer of cfg.peers) {
    if (!peer.id) issues.push("peer.id is required");
    if (peerIds.has(peer.id)) issues.push(`duplicate peer id '${peer.id}'`);
    peerIds.add(peer.id);
  }

  if (issues.length) {
    throw new NatTraversalError("invalid_config", issues.join("; "), issues);
  }
  return cfg;
}

export function publicConfigView(config, secretsMeta = {}) {
  const cfg = normalizeNatTraversalConfig(config);
  return {
    ...cfg,
    secrets: {
      frpcTokenConfigured: Boolean(secretsMeta.frpcTokenConfigured),
      dashboardAuthConfigured: Boolean(secretsMeta.dashboardAuthConfigured),
    },
  };
}
