import fs from "node:fs";
import path from "node:path";
import { NatTraversalError } from "../domain/errors.mjs";
import { LINK_STATUS } from "../domain/status.mjs";
import {
  createCloudflaredSupervisor,
  resolveCloudflaredBin,
} from "../process/cloudflared-supervisor.mjs";
import { validateNatTraversalConfig } from "../domain/config-schema.mjs";

export function createCloudflaredProvider({
  paths,
  logger = console,
  supervisorFactory = createCloudflaredSupervisor,
  cloudflaredRunner,
  whichBin,
} = {}) {
  let supervisor = null;
  let currentConfig = null;
  let currentToken = "";

  function resolveBin(config) {
    const configured = String(config?.cloudflared?.binPath || "").trim();
    return resolveCloudflaredBin({ configuredPath: configured, whichBin });
  }

  function ensureSupervisor(config) {
    const cfg = config || currentConfig || { cloudflared: {} };
    const binPath = resolveBin(cfg);
    const pidPath = paths?.cloudflaredPidPath || path.join(paths?.dataDir || ".", "cloudflared.pid");
    const logPath = paths?.cloudflaredLogPath || path.join(paths?.dataDir || ".", "cloudflared.log");
    supervisor = supervisorFactory({
      binPath,
      pidPath,
      logPath,
      logger,
      spawnRunner: cloudflaredRunner,
    });
    return { supervisor, binPath, pidPath, logPath };
  }

  return {
    id: "cloudflared",
    capabilities() {
      return ["tunnel", "process-control", "quick-tunnel", "token-tunnel"];
    },
    resolveBin(config) {
      return resolveBin(config || currentConfig);
    },
    validateConfig(config) {
      validateNatTraversalConfig(config);
      return { ok: true };
    },
    async applyConfig(config, { token = "" } = {}) {
      const cfg = validateNatTraversalConfig(config);
      currentConfig = cfg;
      currentToken = token;
      ensureSupervisor(cfg);
      return { ok: true };
    },
    async start(config) {
      if (config) currentConfig = validateNatTraversalConfig(config);
      const cfg = currentConfig || { cloudflared: {} };
      const { supervisor: sup } = ensureSupervisor(cfg);
      return sup.start({
        mode: cfg.cloudflared?.mode || "quick",
        localUrl: cfg.cloudflared?.localUrl || "http://127.0.0.1:8787",
        token: currentToken,
        publicUrl: cfg.cloudflared?.publicUrl || "",
      });
    },
    async stop(config) {
      if (config) currentConfig = validateNatTraversalConfig(config);
      const { supervisor: sup } = ensureSupervisor(currentConfig);
      return sup.stop();
    },
    async status(config) {
      if (config) {
        try {
          currentConfig = validateNatTraversalConfig(config);
        } catch {
          currentConfig = config;
        }
      }
      const { supervisor: sup } = ensureSupervisor(currentConfig);
      return sup.getStatus();
    },
    async ensureLink(peer) {
      const st = await this.status();
      if (st.status !== "running") {
        throw new NatTraversalError(
          "not_running",
          "cloudflared tunnel is not running; start NAT Traversal first",
        );
      }
      return {
        peerId: peer?.id || "",
        provider: "cloudflared",
        status: LINK_STATUS.online,
        endpoint: peer?.services?.gatewayApi || "",
      };
    },
    async linkStatus(peer) {
      return this.testLink(peer);
    },
    async testLink(peer) {
      if (!peer) {
        throw new NatTraversalError("peer_not_found", "peer is required");
      }
      const target = peer?.services?.gatewayApi;
      if (!target) {
        return {
          peerId: peer.id,
          status: LINK_STATUS.unknown,
          message: "no gatewayApi endpoint configured",
        };
      }
      try {
        const url = target.startsWith("http://") || target.startsWith("https://") ? target : `https://${target}`;
        const res = await fetch(url, { method: "GET" });
        return {
          peerId: peer.id,
          status: res.ok ? LINK_STATUS.online : LINK_STATUS.error,
          httpStatus: res.status,
          url,
        };
      } catch (error) {
        return {
          peerId: peer.id,
          status: LINK_STATUS.offline,
          message: error.message || String(error),
        };
      }
    },
    async openService(peer, service) {
      if (service === "gateway-api") {
        const endpoint = peer?.services?.gatewayApi;
        if (!endpoint) {
          throw new NatTraversalError(
            "service_not_configured",
            `peer '${peer.id}' does not have gatewayApi configured`,
          );
        }
        return {
          peerId: peer.id,
          service,
          endpoint: endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : `https://${endpoint}`,
        };
      }
      throw new NatTraversalError("unsupported_service", `service '${service}' is not supported by cloudflared provider`);
    },
  };
}
