import { normalizeLanternError } from "./errors.mjs";

export function createCommandQueue({
  execute,
  report,
  now = Date.now,
  maxCompleted = 1_000,
  ttlMs = 5 * 60_000,
} = {}) {
  if (typeof execute !== "function") throw new TypeError("command queue requires execute");
  if (typeof report !== "function") throw new TypeError("command queue requires report");

  const inFlight = new Map();
  const completed = new Map();
  let tail = Promise.resolve();

  function pruneCompleted() {
    const cutoff = now() - ttlMs;
    for (const [id, entry] of completed) {
      if (entry.completedAt <= cutoff) completed.delete(id);
    }
    while (completed.size > maxCompleted) {
      completed.delete(completed.keys().next().value);
    }
  }

  function cacheCompleted(id, envelope) {
    completed.delete(id);
    completed.set(id, { envelope, completedAt: now() });
    pruneCompleted();
  }

  async function executeEnvelope(command) {
    try {
      const value = await execute(command);
      if (value && typeof value === "object" && typeof value.ok === "boolean") return value;
      return { ok: true, result: value };
    } catch (error) {
      return { ok: false, error: normalizeLanternError(error) };
    }
  }

  async function reportSources(record, envelope) {
    const reported = new Set();
    for (;;) {
      const pending = [...record.sources].filter((source) => !reported.has(source));
      if (!pending.length) return;
      for (const source of pending) {
        reported.add(source);
        await report(source, record.command.id, envelope);
      }
    }
  }

  function submit(sourceUrl, command) {
    const id = String(command?.id || "");
    if (!id) return Promise.reject(new TypeError("command queue requires command.id"));
    pruneCompleted();

    const cached = completed.get(id);
    if (cached) {
      completed.delete(id);
      completed.set(id, cached);
      return Promise.resolve(report(sourceUrl, id, cached.envelope)).then(() => cached.envelope);
    }

    const existing = inFlight.get(id);
    if (existing) {
      existing.sources.add(sourceUrl);
      return existing.promise;
    }

    const record = {
      command,
      sources: new Set([sourceUrl]),
      promise: null,
    };
    const run = tail.then(async () => {
      const envelope = await executeEnvelope(command);
      cacheCompleted(id, envelope);
      await reportSources(record, envelope);
      return envelope;
    });
    tail = run.catch(() => undefined);
    record.promise = run.finally(() => {
      inFlight.delete(id);
    });
    inFlight.set(id, record);
    return record.promise;
  }

  return { submit };
}
