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
  inferModelFromTrajectoryDetail,
  inferRecommendedModelFromConfigData,
  pollTrajectoryEvents,
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
  let autoModel = "";
  let autoModelSource = "";
  let suppressAutoModelCache = false;
  const pendingApprovalsTracker = new Map();

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

  async function resolveAutoModel() {
    if (autoModel && !suppressAutoModelCache) {
      return { model: autoModel, source: autoModelSource };
    }
    if (!connectClient) {
      return { model: "", source: "" };
    }

    for (let i = 0; i < cachedConversations.length; i += 1) {
      const conversation = cachedConversations[i];
      try {
        const raw = await connectClient.getCascadeTrajectory(conversation.id);
        const detail = summarizeTrajectoryDetail(raw, {
          cascadeId: conversation.id,
        });
        const model = inferModelFromTrajectoryDetail(detail);
        if (model) {
          if (!suppressAutoModelCache) autoModel = model;
          autoModelSource = "recent-conversation";
          return { model, source: "recent-conversation" };
        }
      } catch {
        // Try the next recent conversation.
      }
    }

    try {
      if (typeof connectClient.getCascadeModelConfigData === "function") {
        const config = await connectClient.getCascadeModelConfigData();
        const model = inferRecommendedModelFromConfigData(config);
        if (model) {
          if (!suppressAutoModelCache) autoModel = model;
          autoModelSource = "recommended-config";
          return { model, source: "recommended-config" };
        }
      }
    } catch {
      // Keep the known-safe default below.
    }

    if (!suppressAutoModelCache) autoModel = "MODEL_PLACEHOLDER_M298";
    autoModelSource = "safe-default";
    return { model: "MODEL_PLACEHOLDER_M298", source: "safe-default" };
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
        caps.push("subscribeEvents");
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

      let selectedModel = model;
      if (!selectedModel && modelAlias && modelAlias !== "AUTO") {
        selectedModel = modelAlias;
      }
      if (!selectedModel) {
        selectedModel = (await resolveAutoModel()).model;
      }
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
    async subscribeEvents({
      conversationId,
      cursor = 0,
      intervalMs = 1000,
      timeoutMs = 0,
    } = {}) {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      if (!connectClient) throw unsupported("subscribeEvents");
      if (!conversationId) {
        throw new RemoteSessionError("invalid_request", "conversationId is required");
      }
      // Practical live subscription via GetCascadeTrajectory polling.
      // Native StreamAgentStateUpdates needs Connect streaming framing and is not
      // yet the default path.
      return pollTrajectoryEvents({
        client: connectClient,
        conversationId,
        cursor,
        intervalMs,
        timeoutMs,
      });
    },
    async listPendingApprovals(conversationId) {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      const tracked = pendingApprovalsTracker.get(conversationId) || [];
      if (connectClient && conversationId) {
        try {
          const live = await connectClient.getCascadeTrajectory(conversationId);
          const detail = summarizeTrajectoryDetail(live, { cascadeId: conversationId });
          const livePending = detail.pendingApprovals || [];
          for (const item of livePending) {
            if (!tracked.some((t) => t.approvalId === item.approvalId)) {
              tracked.push(item);
            }
          }
          pendingApprovalsTracker.set(conversationId, tracked);
        } catch (err) {
          logger?.warn?.(
            "[remote-session] listPendingApprovals fetch failed:",
            err?.message || String(err),
          );
        }
      }
      return tracked.filter((item) => item.status === "pending").map((item) => ({ ...item }));
    },
    async decideApproval({ conversationId, approvalId, decision, controllerPeerId }) {
      if (!attached) throw new RemoteSessionError("host_backend_unavailable", "not attached");
      const normalized = String(decision || "").toLowerCase();
      if (normalized !== "allow" && normalized !== "deny") {
        throw new RemoteSessionError("invalid_request", "decision must be allow or deny");
      }
      const tracked = pendingApprovalsTracker.get(conversationId) || [];
      let item = tracked.find((a) => a.approvalId === approvalId);
      if (!item) {
        item = {
          approvalId,
          summary: "Approval decided",
          status: "pending",
          turnId: `turn_${Date.now()}`,
        };
        tracked.push(item);
        pendingApprovalsTracker.set(conversationId, tracked);
      }
      item.status = normalized;
      item.decidedAt = Date.now();
      item.decidedBy = controllerPeerId || "";

      const event = {
        type: "turn_completed",
        conversationId,
        approvalId,
        decision: normalized,
        turnId: item.turnId || `turn_${Date.now()}`,
        controllerPeerId: controllerPeerId || "",
        ts: Date.now(),
      };

      if (connectClient && conversationId) {
        try {
          const msg =
            normalized === "allow"
              ? "Approved: Proceed with the requested operation."
              : "Denied: Do not perform the requested operation.";
          await connectClient.sendUserCascadeMessage(
            buildSendUserCascadeMessageRequest({
              cascadeId: conversationId,
              prompt: msg,
            }),
          );
        } catch (error) {
          logger?.warn?.(
            "[remote-session] decideApproval follow-up prompt failed:",
            error?.message || String(error),
          );
        }
      }

      return { ok: true, approvalId, decision: normalized, event };
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
    async getAutoModel() {
      return resolveAutoModel();
    },
    async listAvailableModels() {
      return [
        { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash High (Fast)", isRecommended: true },
        { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash Medium (Fast)" },
        { id: "gemini-3.5-flash-medium", name: "Gemini 3.5 Flash Medium (Fast)" },
        { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro Low" },
        { id: "claude-sonnet-4-6-thinking", name: "Claude Sonnet 4.6 (Thinking)" },
        { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
        { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
      ];
    },
    __setRecentConversationIdsForTest(ids = []) {
      cachedConversations = ids.map((id) => ({
        id,
        cascadeId: id,
        conversationId: id,
      }));
      suppressAutoModelCache = true;
    },
  };
}
