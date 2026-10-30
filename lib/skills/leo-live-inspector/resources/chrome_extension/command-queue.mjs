import { normalizeLanternError, lanternError } from "./errors.mjs";

export function createCommandQueue({
  execute,
  report,
  now = Date.now,
  maxCompleted = 1_000,
  ttlMs = 5 * 60_000,
  defaultTimeoutMs = 15_000,
} = {}) {
  if (typeof execute !== "function") throw new TypeError("command queue requires execute");
  if (typeof report !== "function") throw new TypeError("command queue requires report");

  const inFlight = new Map();
  const completed = new Map();
  let tail = Promise.resolve();
  let lastCommandSuccessAt = null;

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

  function withTimeout(promise, ms, message) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(lanternError("command_timeout", message));
      }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
    });
  }

  async function executeEnvelope(command) {
    const timeoutMs = Number(command?.timeoutMs) || defaultTimeoutMs;
    try {
      const value = await withTimeout(
        Promise.resolve().then(() => execute(command)),
        timeoutMs,
        `Command '${command?.type || command?.id || "unknown"}' timed out after ${timeoutMs}ms in extension queue`
      );
      if (value && typeof value === "object" && typeof value.ok === "boolean") {
        if (value.ok) lastCommandSuccessAt = now();
        return value;
      }
      if (value && typeof value === "object" && (value.error || value.clicked === false || value.filled === false)) {
        return { ok: false, error: normalizeLanternError(value.error || value) };
      }
      lastCommandSuccessAt = now();
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
        try {
          await withTimeout(
            Promise.resolve().then(() => report(source, record.command.id, envelope)),
            5_000,
            "Reporting result to source timed out"
          );
        } catch {}
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

  return {
    submit,
    getLastCommandSuccessAt: () => lastCommandSuccessAt,
  };
}
