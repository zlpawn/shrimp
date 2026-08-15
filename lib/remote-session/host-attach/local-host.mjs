// Local host backend adapter with partial filesystem support.

import { RemoteSessionError } from "../domain/errors.mjs";
import { probeLocalAntigravityBackend } from "./probe.mjs";
import {
  defaultAntigravityPaths,
  discoverDynamicLocalEndpoint,
  listProjectsFromStore,
  summarizePartialHostSupport,
} from "./project-store.mjs";

export function createLocalHostBackend({
  id = "local-host",
  probe = probeLocalAntigravityBackend,
  listProjectsImpl = listProjectsFromStore,
  discoverEndpointImpl = discoverDynamicLocalEndpoint,
  paths = defaultAntigravityPaths(),
  logger = console,
  allowPartialAttach = true,
} = {}) {
  let lastProbe = null;
  let attached = false;
  let attachInfo = null;
  let cachedProjects = [];

  async function runProbe() {
    lastProbe = await probe();
    return lastProbe;
  }

  function unsupported(method) {
    return new RemoteSessionError(
      "unsupported_feature",
      "local host backend does not support " + method + " yet",
      { probe: lastProbe || null, attach: attachInfo || null },
    );
  }

  return {
    id,
    capabilities() {
      const support = summarizePartialHostSupport({
        projects: cachedProjects,
        endpoint: attachInfo?.endpoint || null,
      });
      const caps = ["isRunning", "attach"];
      if (support.listProjects) caps.push("listProjects");
      return caps;
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

      const endpoint = discoverEndpointImpl({
        mainLogPath: paths.mainLogPath,
      });
      cachedProjects = listProjectsImpl({
        storeDir: paths.projectStoreDir,
      });
      const support = summarizePartialHostSupport({
        projects: cachedProjects,
        endpoint,
      });

      // Full attach still unsupported until conversation/prompt/approval APIs are confirmed.
      // Partial attach is allowed so Host can at least list real projects.
      if (!report.supported && !allowPartialAttach) {
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
      attachInfo = {
        mode: report.supported ? "full" : "partial",
        reason: report.supported
          ? "full-attach-surface"
          : "filesystem-projects-and-dynamic-endpoint-only",
        endpoint,
        support,
        probe: report,
      };

      if (attachInfo.mode === "partial") {
        logger?.warn?.(
          "[remote-session] local host partial attach:",
          attachInfo.reason,
          endpoint?.url || "(no endpoint)",
          "projects=" + cachedProjects.length,
        );
      }

      return {
        backendId: id,
        transport: attachInfo.mode === "full" ? "local-probe" : "local-partial",
        endpoint,
        support,
        probe: report,
      };
    },
    async listProjects() {
      if (!attached) {
        throw new RemoteSessionError("host_backend_unavailable", "not attached");
      }
      // Refresh on each call so newly added projects appear without reattach.
      cachedProjects = listProjectsImpl({
        storeDir: paths.projectStoreDir,
      });
      if (!cachedProjects.length) {
        throw new RemoteSessionError(
          "unsupported_feature",
          "no projects found in Antigravity project store",
          { storeDir: paths.projectStoreDir },
        );
      }
      return cachedProjects.map((project) => ({ ...project }));
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
    async getAttachInfo() {
      return attachInfo;
    },
  };
}
