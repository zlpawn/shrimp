// Application service: sole orchestration entry for NAT Traversal.

import {
  normalizeNatTraversalConfig,
  publicConfigView,
  validateNatTraversalConfig,
  defaultNatTraversalConfig,
} from "../domain/config-schema.mjs";
import { NatTraversalError } from "../domain/errors.mjs";
import { createProviderRegistry } from "../providers/registry.mjs";
import { createNatTraversalSecretStore } from "../infra/secret-store.mjs";
import { createDashboardProxy } from "../infra/dashboard-proxy.mjs";
import {
  discoverFrpcConfigs,
  readFrpcConfigFile,
  inferDashboardUrl,
} from "../infra/frpc-config-io.mjs";

export function createNatTraversalService({
  paths,
  configStore,
  secretStore,
  providerRegistry,
  dashboardProxy,
  logger = console,
} = {}) {
  if (!paths) throw new Error("paths is required");
  if (!configStore) throw new Error("configStore is required");

  const secrets =
    secretStore || createNatTraversalSecretStore({ secretsPath: paths.secretsPath });
  const providers =
    providerRegistry || createProviderRegistry({ paths, logger });
  const dash =
    dashboardProxy ||
    createDashboardProxy({
      getTarget: () => {
        const cfg = getConfig();
        return cfg.frpsDashboard;
      },
      getAuth: () => secrets.load().frpsDashboard,
      logger,
    });

  function getConfig() {
    const raw = configStore.get?.() || defaultNatTraversalConfig();
    return normalizeNatTraversalConfig(raw);
  }

  function assertEnabled(cfg = getConfig()) {
    if (!cfg.enabled) {
      throw new NatTraversalError(
        "not_enabled",
        "NAT Traversal is disabled. Enable natTraversal.enabled first.",
      );
    }
  }

  function activeProvider(cfg = getConfig()) {
    return providers.get(cfg.activeProvider || "frpc");
  }

  async function capabilities() {
    const cfg = getConfig();
    return {
      enabled: Boolean(cfg.enabled),
      activeProvider: cfg.activeProvider,
      providers: providers.list(),
      features: {
        frpcProcessControl: true,
        frpsDashboardProxy: true,
        peerManualConfig: true,
        peerTestLink: true,
      },
    };
  }

  async function getPublicConfig() {
    return publicConfigView(getConfig(), secrets.meta());
  }

  async function updateConfig(patch = {}, secretPatch = {}) {
    const current = getConfig();
    const merged = normalizeNatTraversalConfig({
      ...current,
      ...patch,
      frpc: { ...current.frpc, ...(patch.frpc || {}) },
      frpsDashboard: {
        ...current.frpsDashboard,
        ...(patch.frpsDashboard || {}),
      },
      peers: patch.peers !== undefined ? patch.peers : current.peers,
    });
    const validated = validateNatTraversalConfig(merged);
    configStore.save(validated);

    if (secretPatch && Object.keys(secretPatch).length) {
      secrets.save(secretPatch);
    }

    // Keep generated provider config in sync when enabled.
    if (validated.enabled) {
      const provider = activeProvider(validated);
      const token = secrets.load().frpc?.token || "";
      await provider.applyConfig(validated, { token });
    }

    return getPublicConfig();
  }

  async function status() {
    const cfg = getConfig();
    let providerStatus = {
      status: "stopped",
      pid: 0,
      recentLogs: [],
      lastError: "",
    };
    try {
      providerStatus = await activeProvider(cfg).status();
    } catch (error) {
      providerStatus = {
        status: "error",
        pid: 0,
        recentLogs: [],
        lastError: error.message || String(error),
      };
    }
    const dashboard = await dash.status();
    return {
      enabled: Boolean(cfg.enabled),
      activeProvider: cfg.activeProvider,
      provider: providerStatus,
      dashboard,
      peers: cfg.peers.map((peer) => ({
        id: peer.id,
        displayName: peer.displayName,
      })),
    };
  }

  async function start() {
    const cfg = getConfig();
    assertEnabled(cfg);
    const provider = activeProvider(cfg);
    const token = secrets.load().frpc?.token || "";
    await provider.applyConfig(cfg, { token });
    const result = await provider.start();
    return { ok: true, provider: result };
  }

  async function stop() {
    const cfg = getConfig();
    const provider = activeProvider(cfg);
    const result = await provider.stop();
    return { ok: true, provider: result };
  }

  async function restart() {
    await stop().catch(() => {});
    return start();
  }

  async function listPeers() {
    return getConfig().peers;
  }

  async function upsertPeer(peer) {
    const cfg = getConfig();
    if (!peer?.id) {
      throw new NatTraversalError("invalid_request", "peer.id is required");
    }
    const nextPeers = [...cfg.peers];
    const idx = nextPeers.findIndex((item) => item.id === peer.id);
    const normalized = normalizeNatTraversalConfig({
      ...cfg,
      peers: [peer],
    }).peers[0];
    if (idx >= 0) nextPeers[idx] = normalized;
    else nextPeers.push(normalized);
    await updateConfig({ peers: nextPeers });
    return normalized;
  }

  async function deletePeer(peerId) {
    const cfg = getConfig();
    const nextPeers = cfg.peers.filter((peer) => peer.id !== peerId);
    if (nextPeers.length === cfg.peers.length) {
      throw new NatTraversalError("peer_not_found", `peer '${peerId}' not found`);
    }
    await updateConfig({ peers: nextPeers });
    return { ok: true };
  }

  async function testLink(peerId) {
    const cfg = getConfig();
    assertEnabled(cfg);
    const peer = cfg.peers.find((item) => item.id === peerId);
    if (!peer) {
      throw new NatTraversalError("peer_not_found", `peer '${peerId}' not found`);
    }
    return activeProvider(cfg).testLink(peer);
  }

  async function dashboardStatus() {
    return dash.status();
  }

  async function proxyDashboard(req, res, suffixPath) {
    return dash.proxy(req, res, suffixPath);
  }


  async function discoverLocalFrpc() {
    const found = discoverFrpcConfigs();
    return {
      candidates: found,
      suggestedDashboardPort: 7500,
    };
  }

  async function importLocalFrpc({ path: filePath, setEnabled = true } = {}) {
    if (!filePath) {
      throw new NatTraversalError("invalid_request", "path is required");
    }
    const { path: resolvedPath, parsed } = readFrpcConfigFile(filePath);
    const current = getConfig();
    const dashboardPort = 7500;
    const next = {
      enabled: setEnabled ? true : current.enabled,
      activeProvider: "frpc",
      frpc: {
        ...current.frpc,
        configPath: resolvedPath,
        serverAddr: parsed.serverAddr || current.frpc.serverAddr,
        serverPort: parsed.serverPort || current.frpc.serverPort || 7000,
        logLevel: parsed.logLevel || current.frpc.logLevel || "info",
        proxies: parsed.proxies?.length ? parsed.proxies : current.frpc.proxies,
      },
      frpsDashboard: {
        ...current.frpsDashboard,
        // keep enabled as-is; only fill URL when empty or host changed
        url:
          current.frpsDashboard?.url &&
          current.frpsDashboard.url.includes(parsed.serverAddr || "___never___")
            ? current.frpsDashboard.url
            : inferDashboardUrl(parsed.serverAddr, dashboardPort) ||
              current.frpsDashboard?.url ||
              "",
      },
      peers: current.peers,
    };

    const secretPatch = {};
    if (parsed.token) {
      secretPatch.frpc = { token: parsed.token };
    }

    const view = await updateConfig(next, secretPatch);
    return {
      importedFrom: resolvedPath,
      config: view,
      inferredDashboardUrl: inferDashboardUrl(parsed.serverAddr, dashboardPort),
      tokenImported: Boolean(parsed.token),
    };
  }

  return {
    capabilities,
    getPublicConfig,
    updateConfig,
    discoverLocalFrpc,
    importLocalFrpc,
    status,
    start,
    stop,
    restart,
    listPeers,
    upsertPeer,
    deletePeer,
    testLink,
    dashboardStatus,
    proxyDashboard,
  };
}
