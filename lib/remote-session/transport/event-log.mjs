// Append-only in-memory event log with cursor support.

export function createMemoryEventLog() {
  const events = [];

  return {
    append(event = {}) {
      const record = {
        ...event,
        seq: events.length + 1,
        ts: Number(event.ts) || Date.now(),
      };
      events.push(record);
      return record;
    },
    list(cursor = 0) {
      const start = Number(cursor || 0);
      return events.filter((event) => event.seq > start).map((event) => ({ ...event }));
    },
    latestSeq() {
      return events.length ? events[events.length - 1].seq : 0;
    },
    size() {
      return events.length;
    },
  };
}
