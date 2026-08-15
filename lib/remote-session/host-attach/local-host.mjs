// Local host backend adapter with partial filesystem support.

import { RemoteSessionError } from "../domain/errors.mjs";
import { probeLocalAntigravityBackend } from "./probe.mjs";
import {
  getConversationFromStore,
  listConversationsFromStore,
  defaultBrainDir,
} from "./conversation-store.mjs";
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
  listConversationsImpl = listConversationsFromStore,
  getConversationImpl = getConversationFromStore,
  discoverEndpointImpl = discoverDynamicLocalEndpoint,
  paths = defaultAntigravityPaths(),
  brainDir = defaultBrainDir(),
  logger = console,
  allowPartialAttach = true,
} = {}) {
  let lastProbe = null;
  let attached = false;
  let attachInfo = null;
  let cachedProjects = [];
  let cachedConversations = [];

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

  function refreshConversations(limit = 20) {
    cachedConversations = listConversationsImpl({
      conversationsDir: paths.conversationsDir,
      brainDir,
      limit,
    });
    return cachedConversations;
  }

  return {
    id,
    capabilities() {
      const support = summarizePartialHostSupport({
        projects: cachedProjects,
        endpoint: attachInfo?.endpoint || null,
        conversations: cachedConversations,
      });
      const caps = ["isRunning", "attach"];
      if (support.listProjects) caps.push("listProjects");
      if (support.listConversations) caps.push("listConversations");
      if (support.getConversation) caps.push("getConversation");
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
      refreshConversations(20);
      const support = summarizePartialHostSupport({
        projects: cachedProjects,
        endpoint,
        conversations: cachedConversations,
      });

      // Full attach still unsupported until conversation/prompt/approval APIs are confirmed.
      // Partial attach is allowed so Host can at least list real projects and inspect sessions.
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
          : "filesystem-projects-conversations-and-dynamic-endpoint-only",
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
          "conversations=" + cachedConversations.length,
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
    async listConversations({ limit = 20 } = {}) {
      if (!attached) {
        throw new RemoteSessionError("host_backend_unavailable", "not attached");
      }
      refreshConversations(limit);
      return cachedConversations.map((item) => ({ ...item }));
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
    async getConversation(conversationId) {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      const snapshot = getConversationImpl({
        cascadeId: conversationId,
        conversationsDir: paths.conversationsDir,
        brainDir,
      });
      if (!snapshot) {
        throw new RemoteSessionError(
          "invalid_request",
          "conversation not found: " + conversationId,
          { conversationId },
        );
      }
      return snapshot;
    },
    async getLastProbe() {
      return lastProbe;
    },
    async getAttachInfo() {
      return attachInfo;
    },
  };
}
