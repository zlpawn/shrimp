// Local host backend adapter with partial filesystem support.

import { RemoteSessionError } from "../domain/errors.mjs";
import { probeLocalAntigravityBackend } from "./probe.mjs";
import {
  getConversationFromStore,
  listConversationsFromStore,
  defaultBrainDir,
} from "./conversation-store.mjs";
import {
  buildCascadeConfig,
  buildRequestedModel,
  buildRequestedModelAlias,
  buildSendUserCascadeMessageRequest,
  buildStartCascadeRequest,
  createLanguageServerConnectClient,
  discoverLanguageServerConnectEndpoint,
  summarizeTrajectoryDetail,
  summarizeTrajectoryList,
  toFileUri,
} from "./language-server-connect.mjs";
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
  discoverConnectImpl = discoverLanguageServerConnectEndpoint,
  connectClientFactory = createLanguageServerConnectClient,
  paths = defaultAntigravityPaths(),
  brainDir = defaultBrainDir(),
  logger = console,
  allowPartialAttach = true,
  preferLiveConnect = true,
} = {}) {
  let lastProbe = null;
  let attached = false;
  let attachInfo = null;
  let cachedProjects = [];
  let cachedConversations = [];
  let connectClient = null;
  let connectInfo = null;

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
      if (connectClient) {
        caps.push("createConversation");
        caps.push("dispatchPrompt");
      }
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

      connectClient = null;
      connectInfo = null;
      if (preferLiveConnect) {
        try {
          connectInfo = await discoverConnectImpl({
            paths,
            discoverEndpointImpl,
          });
          if (connectInfo?.ok) {
            connectClient = connectClientFactory({
              baseUrl: connectInfo.baseUrl,
              csrfToken: connectInfo.csrfToken,
            });
            // Validate with a cheap read-only RPC.
            await connectClient.getAllCascadeTrajectories();
          }
        } catch (error) {
          logger?.warn?.(
            "[remote-session] language-server connect unavailable:",
            error?.message || String(error),
          );
          connectClient = null;
        }
      }

      if (connectClient) {
        try {
          const live = await connectClient.getAllCascadeTrajectories();
          cachedConversations = summarizeTrajectoryList(live);
        } catch (error) {
          logger?.warn?.(
            "[remote-session] live conversation list failed, fallback filesystem:",
            error?.message || String(error),
          );
          refreshConversations(20);
        }
      } else {
        refreshConversations(20);
      }

      const support = summarizePartialHostSupport({
        projects: cachedProjects,
        endpoint,
        conversations: cachedConversations,
        liveConnect: Boolean(connectClient),
        experimentalWrite: Boolean(connectClient),
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
          : connectClient
            ? "language-server-connect-readonly-plus-filesystem"
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
        transport: attachInfo.mode === "full"
          ? "local-probe"
          : connectClient
            ? "local-connect-readonly"
            : "local-partial",
        endpoint,
        connect: connectInfo
          ? {
              ok: Boolean(connectClient),
              baseUrl: connectInfo.baseUrl || "",
              reason: connectInfo.reason || "",
            }
          : null,
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
      if (connectClient) {
        try {
          const live = await connectClient.getAllCascadeTrajectories();
          cachedConversations = summarizeTrajectoryList(live);
        } catch (error) {
          logger?.warn?.(
            "[remote-session] live listConversations failed, fallback filesystem:",
            error?.message || String(error),
          );
          refreshConversations(limit);
        }
      } else {
        refreshConversations(limit);
      }
      const n = Math.max(0, Number(limit) || 0);
      const items = cachedConversations.map((item) => ({ ...item }));
      return n > 0 ? items.slice(0, n) : items;
    },
    async createConversation(projectId, options = {}) {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      if (!connectClient) throw unsupported("createConversation");

      // Experimental: StartCascade is confirmed, but full turn still needs model config.
      const projects = cachedProjects.length
        ? cachedProjects
        : listProjectsImpl({ storeDir: paths.projectStoreDir });
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        throw new RemoteSessionError("invalid_request", "project not found: " + projectId);
      }
      const workspacePath = project.path || options.workspacePath || "";
      if (!workspacePath) {
        throw new RemoteSessionError(
          "invalid_request",
          "project has no workspace path for StartCascade",
          { projectId },
        );
      }
      const body = buildStartCascadeRequest({
        workspacePath,
        cascadeId: options.cascadeId,
      });
      const created = await connectClient.startCascade(body);
      const conversationId = created?.cascadeId || body.cascadeId;
      return {
        conversationId,
        cascadeId: conversationId,
        projectId,
        workspaceUri: toFileUri(workspacePath),
        mode: "experimental_start_cascade",
        note: "StartCascade succeeded; dispatchPrompt can complete a turn with cascadeConfig.requestedModel",
      };
    },
    async dispatchPrompt({ conversationId, prompt, controllerPeerId, modelAlias = "AUTO", model = null, cascadeConfig = null } = {}) {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      if (!connectClient) throw unsupported("dispatchPrompt");
      if (!conversationId) {
        throw new RemoteSessionError("invalid_request", "conversationId is required");
      }
      if (!prompt) {
        throw new RemoteSessionError("invalid_request", "prompt is required");
      }

      const selectedModel =
        model ||
        (modelAlias && modelAlias !== "AUTO"
          ? modelAlias
          : "MODEL_PLACEHOLDER_M298");
      const requestedModel =
        typeof selectedModel === "object"
          ? selectedModel
          : buildRequestedModel(selectedModel);
      const body = buildSendUserCascadeMessageRequest({
        cascadeId: conversationId,
        prompt,
        cascadeConfig: cascadeConfig || buildCascadeConfig({ requestedModel }),
        requestedModel,
      });
      await connectClient.sendUserCascadeMessage(body);

      // Poll briefly for planner response / error. SendUserCascadeMessage returns
      // before the cascade finishes generating.
      let snapshot = null;
      const startedAt = Date.now();
      const timeoutMs = 20000;
      const pollEveryMs = 1000;
      while (Date.now() - startedAt < timeoutMs) {
        try {
          const live = await connectClient.getCascadeTrajectory(conversationId);
          snapshot = summarizeTrajectoryDetail(live, { cascadeId: conversationId });
          const events = snapshot?.events || [];
          const hasAssistantText = events.some(
            (event) =>
              event.type === "assistant_text" &&
              String(event.text || "").trim().length > 0,
          );
          const hasError = events.some(
            (event) =>
              event.type === "error" || /ERROR/i.test(event.hostType || ""),
          );
          const idle = /IDLE/i.test(String(snapshot?.status || ""));
          // Wait until the turn is idle with assistant text, or an error appears.
          // PLANNER_RESPONSE can show up early with empty text while still generating.
          if (hasError || (idle && hasAssistantText) || (idle && Date.now() - startedAt > 3000)) {
            break;
          }
        } catch (error) {
          logger?.warn?.(
            "[remote-session] post-dispatch inspect failed:",
            error?.message || String(error),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
      }

      const events = snapshot?.events || [];
      const errorEvent = events.find(
        (event) => event.type === "error" || /ERROR/i.test(event.hostType || ""),
      );
      if (errorEvent) {
        throw new RemoteSessionError(
          "protocol_error",
          "SendUserCascadeMessage accepted but cascade reported error: " +
            String(errorEvent.text || "unknown"),
          {
            conversationId,
            controllerPeerId: controllerPeerId || "",
            snapshot,
          },
        );
      }
      return {
        turnId: "connect_" + Date.now(),
        events: events.map((event) => ({
          type: event.type,
          text: event.text,
          hostEvent: event,
        })),
        snapshot,
        mode: "experimental_send_user_cascade_message",
      };
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
      if (connectClient) {
        try {
          const live = await connectClient.getCascadeTrajectory(conversationId);
          return summarizeTrajectoryDetail(live, { cascadeId: conversationId });
        } catch (error) {
          logger?.warn?.(
            "[remote-session] live getConversation failed, fallback filesystem:",
            error?.message || String(error),
          );
        }
      }
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
