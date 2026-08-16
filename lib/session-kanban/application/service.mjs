const ACTIVE_WINDOW_MS = 90 * 1000;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function baseStatus(session, now = Date.now()) {
  const activity = Date.parse(session.lastActivityAt || "");
  if (!Number.isFinite(activity)) return "error";
  const age = now - activity;
  if (age <= ACTIVE_WINDOW_MS) return "running";
  return age <= RECENT_WINDOW_MS ? "waiting_input" : "completed";
}

export function createSessionKanbanService({
  store,
  readers = [],
  dispatchers = [],
  now = () => Date.now(),
} = {}) {
  if (!store) throw new Error("store is required");

  async function loadSessions() {
    const results = await Promise.all(readers.map(reader => reader.list()));
    const nowMs = now();
    return results.flat()
      .filter(session => nowMs - Date.parse(session.lastActivityAt || 0) <= MAX_AGE_MS)
      .sort((a, b) => Date.parse(b.lastActivityAt || 0) - Date.parse(a.lastActivityAt || 0));
  }

  return {
    async board() {
      const [sessions, queue] = await Promise.all([loadSessions(), store.list()]);
      const counts = new Map();
      for (const item of queue) {
        if (item.status !== "pending" && item.status !== "dispatching") continue;
        counts.set(item.sessionId, (counts.get(item.sessionId) || 0) + 1);
      }
      return {
        generatedAt: new Date(now()).toISOString(),
        sessions: sessions.map(session => {
          const queuedCount = counts.get(session.id) || 0;
          const status = queuedCount > 0 ? "queued" : baseStatus(session, now());
          return { ...session, status, queuedCount };
        }),
        counts: sessions.reduce((result, session) => {
          result[baseStatus(session, now())] = (result[baseStatus(session, now())] || 0) + 1;
          return result;
        }, {}),
        queue,
      };
    },

    enqueue(input) {
      return store.enqueue(input);
    },

    cancel(id) {
      return store.cancel(id);
    },

    retry(id) {
      return store.retry(id);
    },

    async dispatchReady() {
      const board = await this.board();
      const sessionsById = new Map(board.sessions.map(session => [session.id, session]));
      const pending = board.queue.filter(item => item.status === "pending");
      let dispatched = 0;
      let waiting = 0;

      for (const item of pending) {
        const session = sessionsById.get(item.sessionId);
        const underlyingStatus = session ? baseStatus(session, now()) : "error";
        if (!session || underlyingStatus === "running") {
          waiting += 1;
          continue;
        }
        const dispatcher = dispatchers.find(candidate => candidate.client === session.client && candidate.canDispatch(session));
        if (!dispatcher) {
          await store.claimForDispatch(item.id);
          await store.markFailed(item.id, "No supported dispatcher for this session");
          continue;
        }

        const claimed = await store.claimForDispatch(item.id);
        try {
          const result = await dispatcher.dispatch(session, item.message);
          await store.markDispatched(item.id, {
            command: result?.command || "",
            exitCode: result?.exitCode ?? null,
          });
          dispatched += 1;
        } catch (error) {
          await store.markFailed(item.id, error?.message || String(error));
        }
      }
      return { dispatched, waiting };
    },
  };
}
