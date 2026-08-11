const TRANSIENT_OVERLOAD_STATUSES = new Set([429, 503, 529]);

export const MULTI_KEY_RETRY_LIMITS = Object.freeze({
  perAttemptMs: 15_000,
  maxAttempts: 3,
  totalMs: 30_000,
});

const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function isDeterministicQuotaError(value) {
  const text = String(value || "");
  return /AccountQuotaExceeded/i.test(text)
    || /weekly usage quota/i.test(text)
    || /monthly usage quota/i.test(text)
    || /quota (?:has been |is )?exhausted/i.test(text);
}

export async function shouldRetryUpstreamResponse(response) {
  if (!response || !TRANSIENT_OVERLOAD_STATUSES.has(Number(response.status))) return false;
  if (Number(response.status) !== 429) return true;
  try {
    const text = await response.clone().text();
    return !isDeterministicQuotaError(text);
  } catch {
    return true;
  }
}

export async function shouldFailoverCredential(response) {
  const status = Number(response?.status || 0);
  return status === 429 || (status >= 500 && status <= 599);
}

function abortError(message = "Credential request aborted") {
  return Object.assign(new Error(message), { name: "AbortError" });
}

export async function runCredentialFailover({
  credentials = [],
  request,
  parentSignal,
  limits = MULTI_KEY_RETRY_LIMITS,
  clock = defaultClock,
} = {}) {
  if (!credentials.length) throw new Error("No credentials available");
  if (typeof request !== "function") throw new TypeError("request is required");

  const startedAt = clock.now();
  const maxAttempts = Math.min(
    credentials.length,
    Number(limits.maxAttempts || MULTI_KEY_RETRY_LIMITS.maxAttempts),
  );
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (parentSignal?.aborted) {
      throw parentSignal.reason || abortError();
    }

    const elapsed = clock.now() - startedAt;
    const remainingTotalMs =
      Number(limits.totalMs || MULTI_KEY_RETRY_LIMITS.totalMs) - elapsed;
    if (remainingTotalMs <= 0) break;

    const controller = new AbortController();
    const timeoutMs = Math.min(
      Number(limits.perAttemptMs || MULTI_KEY_RETRY_LIMITS.perAttemptMs),
      remainingTotalMs,
    );
    const onParentAbort = () => controller.abort(
      parentSignal.reason || abortError(),
    );
    if (parentSignal) {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
    const timeout = clock.setTimeout(
      () => controller.abort(abortError("Credential request timed out")),
      timeoutMs,
    );

    try {
      const response = await request({
        credential: credentials[attempt],
        attempt,
        signal: controller.signal,
      });
      lastResponse = response;
      if (!await shouldFailoverCredential(response)) return response;
    } catch (error) {
      lastError = error;
      if (parentSignal?.aborted) {
        throw parentSignal.reason || error;
      }
    } finally {
      clock.clearTimeout(timeout);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || abortError("Credential retry deadline exceeded");
}
