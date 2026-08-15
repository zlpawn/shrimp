// Local host backend adapter. Safe skeleton until real attach surface is confirmed.

import { RemoteSessionError } from "../domain/errors.mjs";
import { probeLocalAntigravityBackend } from "./probe.mjs";

export function createLocalHostBackend({
  id = "local-host",
  probe = probeLocalAntigravityBackend,
  logger = console,
} = {}) {
  let lastProbe = null;
  let attached = false;

  async function runProbe() {
    lastProbe = await probe();
    return lastProbe;
  }

  function unsupported(method) {
    return new RemoteSessionError(
      "unsupported_feature",
      `local host backend does not support ${method} yet`,
      { probe: lastProbe || null },
    );
  }

  return {
    id,
    capabilities() {
      return [];
    },
    async isRunning() {
      const report = await runProbe();
      return Boolean(report.running);
    },
    async attach() {
      const report = await runProbe();
      if (!report.running) {
        throw new RemoteSessionError(
          "host_backend_unavailable",
          "Antigravity is not running on host; open it first",
          { reason: report.reason, probe: report },
        );
      }
      if (!report.supported) {
        logger?.warn?.(
          "[remote-session] local host attach unsupported:",
          report.reason,
        );
        throw new RemoteSessionError(
          "host_backend_unsupported",
          "no safe attach surface found for running Antigravity backend",
          { reason: report.reason, probe: report },
        );
      }
      attached = true;
      return {
        backendId: id,
        transport: "local-probe",
        probe: report,
      };
    },
    async listProjects() {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      throw unsupported("listProjects");
    },
    async createConversation() {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      throw unsupported("createConversation");
    },
    async dispatchPrompt() {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      throw unsupported("dispatchPrompt");
    },
    async subscribeEvents() {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      throw unsupported("subscribeEvents");
    },
    async listPendingApprovals() {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      throw unsupported("listPendingApprovals");
    },
    async decideApproval() {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      throw unsupported("decideApproval");
    },
    async getConversation() {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      throw unsupported("getConversation");
    },
    async getLastProbe() {
      return lastProbe;
    },
  };
}
