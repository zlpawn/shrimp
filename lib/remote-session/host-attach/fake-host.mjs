// Deterministic fake host backend for Remote Session domain/service tests.

import { RemoteSessionError } from "../domain/errors.mjs";
import { HOST_CAPABILITIES } from "./contract.mjs";

function now() {
  return Date.now();
}

function makeId(prefix, n) {
  return `${prefix}_${n}`;
}

export function createFakeHostBackend({
  id = "fake-host",
  projects = [{ id: "p1", name: "demo", path: "/tmp/demo" }],
  scriptedTurns = [],
  running = true,
} = {}) {
  let attached = false;
  let conversationSeq = 0;
  let turnSeq = 0;
  let approvalSeq = 0;
  const conversations = new Map();
  const turnScripts = Array.isArray(scriptedTurns) ? [...scriptedTurns] : [];

  function requireAttached() {
    if (!attached) {
      throw new RemoteSessionError("host_backend_unavailable", "host backend is not attached");
    }
  }

  function getConversationOrThrow(conversationId) {
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      throw new RemoteSessionError(
        "invalid_request",
        `conversation not found: ${conversationId}`,
      );
    }
    return conversation;
  }

  return {
    id,
    capabilities() {
      return [...HOST_CAPABILITIES];
    },
    async isRunning() {
      return Boolean(running);
    },
    async attach() {
      if (!running) {
        throw new RemoteSessionError(
          "host_backend_unavailable",
          "Antigravity is not running on host; open it first",
          { reason: "process_not_found" },
        );
      }
      attached = true;
      return {
        backendId: id,
        transport: "fake",
      };
    },
    async listProjects() {
      requireAttached();
      return projects.map((project) => ({ ...project }));
    },
    async createConversation(projectId) {
      requireAttached();
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        throw new RemoteSessionError("invalid_request", `project not found: ${projectId}`);
      }
      conversationSeq += 1;
      const conversationId = makeId("c", conversationSeq);
      const conversation = {
        id: conversationId,
        projectId,
        createdAt: now(),
        events: [],
        pendingApprovals: [],
        status: "ready",
      };
      conversations.set(conversationId, conversation);
      return { conversationId };
    },
    async dispatchPrompt({ conversationId, prompt, controllerPeerId }) {
      requireAttached();
      const conversation = getConversationOrThrow(conversationId);
      turnSeq += 1;
      const turnId = makeId("t", turnSeq);
      const script = turnScripts.shift() || {
        events: [
          { type: "assistant_text", text: `ack: ${String(prompt || "").slice(0, 80)}` },
          { type: "turn_completed", turnId },
        ],
      };

      const events = [];
      for (const raw of script.events || []) {
        const event = {
          ...raw,
          turnId,
          conversationId,
          controllerPeerId: controllerPeerId || "",
          ts: now(),
          seq: conversation.events.length + 1,
        };
        if (event.type === "approval_required") {
          approvalSeq += 1;
          event.approvalId = event.approvalId || makeId("ap", approvalSeq);
          conversation.pendingApprovals.push({
            approvalId: event.approvalId,
            summary: event.summary || "approval required",
            turnId,
            status: "pending",
          });
          conversation.status = "awaiting_approval";
        }
        if (event.type === "turn_completed") {
          conversation.status = "ready";
        }
        conversation.events.push(event);
        events.push(event);
      }

      return { turnId, events };
    },
    async subscribeEvents({ conversationId, cursor = 0 }) {
      requireAttached();
      const conversation = getConversationOrThrow(conversationId);
      const start = Number(cursor || 0);
      async function* iterator() {
        for (const event of conversation.events) {
          if (event.seq > start) yield event;
        }
      }
      return iterator();
    },
    async listPendingApprovals(conversationId) {
      requireAttached();
      const conversation = getConversationOrThrow(conversationId);
      return conversation.pendingApprovals
        .filter((item) => item.status === "pending")
        .map((item) => ({ ...item }));
    },
    async decideApproval({ conversationId, approvalId, decision, controllerPeerId }) {
      requireAttached();
      const conversation = getConversationOrThrow(conversationId);
      const approval = conversation.pendingApprovals.find((item) => item.approvalId === approvalId);
      if (!approval) {
        throw new RemoteSessionError("invalid_request", `approval not found: ${approvalId}`);
      }
      if (approval.status !== "pending") {
        throw new RemoteSessionError("invalid_request", `approval already decided: ${approvalId}`);
      }
      const normalized = String(decision || "").toLowerCase();
      if (normalized !== "allow" && normalized !== "deny") {
        throw new RemoteSessionError("invalid_request", "decision must be allow or deny");
      }
      approval.status = normalized;
      approval.decidedBy = controllerPeerId || "";
      approval.decidedAt = now();

      const event = {
        type: "turn_completed",
        conversationId,
        approvalId,
        decision: normalized,
        turnId: approval.turnId,
        controllerPeerId: controllerPeerId || "",
        ts: now(),
        seq: conversation.events.length + 1,
      };
      conversation.events.push(event);
      conversation.status = "ready";
      return { ok: true, event };
    },
    async getConversation(conversationId) {
      requireAttached();
      const conversation = getConversationOrThrow(conversationId);
      return {
        id: conversation.id,
        projectId: conversation.projectId,
        status: conversation.status,
        createdAt: conversation.createdAt,
        eventCount: conversation.events.length,
        pendingApprovals: conversation.pendingApprovals
          .filter((item) => item.status === "pending")
          .map((item) => ({ ...item })),
        latestSeq: conversation.events.length
          ? conversation.events[conversation.events.length - 1].seq
          : 0,
      };
    },
  };
}
