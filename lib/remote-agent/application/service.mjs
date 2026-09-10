import { RemoteAgentError, errorStatus } from "../domain/errors.mjs";
import { normalizeEnvelope } from "../domain/envelope.mjs";
import { parseCommand } from "../domain/commands.mjs";
import {
  formatBindSuccess,
  formatHelp,
  formatQueued,
  formatSessionList,
  formatStatus,
  formatUnbound,
  formatUnknown,
} from "../domain/replies.mjs";

const STATUS_RANK = {
  waiting_input: 0,
  queued: 1,
  running: 2,
  completed: 3,
  error: 4,
};

function extractBearer(authorization) {
  const value = String(authorization || "").trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function rankSessions(sessions = []) {
  return [...sessions].sort((a, b) => {
    const rankA = STATUS_RANK[a.status] ?? 99;
    const rankB = STATUS_RANK[b.status] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return Date.parse(b.lastActivityAt || 0) - Date.parse(a.lastActivityAt || 0);
  });
}

function resolveUseTarget(snapshot, target) {
  const value = String(target || "").trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1;
    return snapshot[index] || null;
  }
  const lowered = value.toLowerCase();
  return snapshot.find((item) => {
    return String(item.id || "").toLowerCase() === lowered
      || String(item.title || "").toLowerCase() === lowered
      || String(item.dispatchTarget || "").toLowerCase() === lowered;
  }) || null;
}

export function createRemoteAgentService({
  bindingStore,
  sessionKanban,
  token = "",
  listLimit = 10,
  snapshotMaxAgeMs = 600000,
  now = () => Date.now(),
} = {}) {
  if (!bindingStore) throw new Error("bindingStore is required");
  if (!sessionKanban) throw new Error("sessionKanban is required");

  function assertAuthorized(authorization) {
    const expected = String(token || "").trim();
    if (!expected) {
      throw new RemoteAgentError(
        "unauthorized",
        "Remote-agent token is not configured",
        { status: 401, reply: "远程 Agent 服务未配置访问令牌。" },
      );
    }
    if (extractBearer(authorization) !== expected) {
      throw new RemoteAgentError(
        "unauthorized",
        "Invalid remote-agent token",
        { status: 401, reply: "远程 Agent 访问令牌无效。" },
      );
    }
  }

  async function latestQueueItem(sessionId) {
    if (typeof sessionKanban.listQueue === "function") {
      const rows = await sessionKanban.listQueue();
      return rows.find((item) => item.sessionId === sessionId) || null;
    }
    if (sessionKanban.store && typeof sessionKanban.store.list === "function") {
      const rows = sessionKanban.store.list();
      return rows.find((item) => item.sessionId === sessionId) || null;
    }
    const board = await sessionKanban.board();
    return (board.queue || []).find((item) => item.sessionId === sessionId) || null;
  }

  async function queuePosition(sessionId) {
    const board = await sessionKanban.board();
    const active = (board.queue || []).filter((item) =>
      item.sessionId === sessionId
      && ["pending", "scheduled", "waiting_quota", "dispatching"].includes(item.status),
    );
    return Math.max(active.length, 1);
  }

  return {
    async handleMessage(input, { authorization } = {}) {
      assertAuthorized(authorization);
      const envelope = normalizeEnvelope(input);
      const command = parseCommand(envelope.text);

      if (command.type === "help") {
        return {
          ok: true,
          reply: formatHelp(),
          taskId: null,
          sessionId: null,
          bindingKey: envelope.bindingKey,
          actions: [],
        };
      }

      if (command.type === "unknown") {
        return {
          ok: true,
          reply: formatUnknown(command.target),
          taskId: null,
          sessionId: null,
          bindingKey: envelope.bindingKey,
          actions: [],
        };
      }

      if (command.type === "list") {
        const board = await sessionKanban.board();
        const ranked = rankSessions(board.sessions || []).slice(0, Number(listLimit) || 10);
        bindingStore.saveListSnapshot(envelope.bindingKey, ranked, now());
        return {
          ok: true,
          reply: formatSessionList(ranked),
          taskId: null,
          sessionId: null,
          bindingKey: envelope.bindingKey,
          actions: [],
        };
      }

      if (command.type === "use") {
        const snapshot = bindingStore.getListSnapshot(envelope.bindingKey, {
          maxAgeMs: snapshotMaxAgeMs,
          nowMs: now(),
        });
        let session = resolveUseTarget(snapshot, command.target);
        if (!session) {
          const board = await sessionKanban.board();
          session = resolveUseTarget(board.sessions || [], command.target);
        }
        if (!session) {
          throw new RemoteAgentError(
            "not_found",
            "Target session not found",
            {
              status: errorStatus("not_found"),
              reply: "找不到这个会话。请先发送 /agent list，再使用正确的序号。",
            },
          );
        }
        bindingStore.upsertBinding({
          bindingKey: envelope.bindingKey,
          platform: envelope.platform,
          chatType: envelope.chatType,
          chatId: envelope.chatId,
          userId: envelope.chatType === "group" ? envelope.userId : "",
          client: session.client,
          sessionId: session.id,
          workspacePath: session.workspacePath || "",
          title: session.title || session.id,
          boundByUserId: envelope.userId,
        });
        return {
          ok: true,
          reply: formatBindSuccess(session),
          taskId: null,
          sessionId: session.id,
          bindingKey: envelope.bindingKey,
          actions: [],
        };
      }

      if (command.type === "status") {
        const binding = bindingStore.getBinding(envelope.bindingKey);
        if (!binding) {
          return {
            ok: true,
            reply: formatUnbound(),
            taskId: null,
            sessionId: null,
            bindingKey: envelope.bindingKey,
            actions: [],
          };
        }
        const queueItem = await latestQueueItem(binding.sessionId);
        return {
          ok: true,
          reply: formatStatus(binding, queueItem),
          taskId: queueItem?.id || null,
          sessionId: binding.sessionId,
          bindingKey: envelope.bindingKey,
          actions: [],
        };
      }

      if (command.type === "unbind") {
        bindingStore.clearBinding(envelope.bindingKey);
        return {
          ok: true,
          reply: "已解除当前聊天的会话绑定。",
          taskId: null,
          sessionId: null,
          bindingKey: envelope.bindingKey,
          actions: [],
        };
      }

      // dispatch
      const binding = bindingStore.getBinding(envelope.bindingKey);
      if (!binding) {
        throw new RemoteAgentError(
          "conflict",
          "Chat is not bound to a session",
          {
            status: errorStatus("conflict"),
            reply: formatUnbound(),
          },
        );
      }
      const queued = await sessionKanban.enqueue({
        sessionId: binding.sessionId,
        message: command.raw,
        source: "remote-agent",
        bindingKey: envelope.bindingKey,
        platform: envelope.platform,
        chatType: envelope.chatType,
        chatId: envelope.chatId,
        userId: envelope.userId,
        replyToMessageId: envelope.replyToMessageId || "",
      });
      bindingStore.touchBinding(envelope.bindingKey, now());
      const position = await queuePosition(binding.sessionId);
      return {
        ok: true,
        reply: formatQueued(binding, position),
        taskId: queued.id,
        sessionId: binding.sessionId,
        bindingKey: envelope.bindingKey,
        actions: [],
      };
    },
  };
}
