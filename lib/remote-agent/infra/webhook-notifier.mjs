export function createWebhookNotifier({
  webhookUrl = "",
  token = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  now = () => Date.now(),
} = {}) {
  async function notify(event = {}) {
    const url = String(webhookUrl || "").trim();
    if (!url) {
      return { ok: true, skipped: true, status: 0, body: "", error: "" };
    }
    if (typeof fetchImpl !== "function") {
      return { ok: false, skipped: false, status: 0, body: "", error: "fetchImpl is not available" };
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), Math.max(Number(timeoutMs) || 8000, 1))
      : null;
    try {
      const headers = {
        "Content-Type": "application/json; charset=utf-8",
      };
      const bearer = String(token || "").trim();
      if (bearer) headers.Authorization = `Bearer ${bearer}`;

      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...event,
          sentAt: new Date(now()).toISOString(),
        }),
        signal: controller?.signal,
      });
      const body = typeof response?.text === "function" ? await response.text() : "";
      const status = Number(response?.status || 0);
      const ok = Boolean(response?.ok) || (status >= 200 && status < 300);
      if (!ok) {
        return {
          ok: false,
          skipped: false,
          status,
          body: String(body || "").slice(0, 500),
          error: `Webhook returned HTTP ${status || "unknown"}`,
        };
      }
      return {
        ok: true,
        skipped: false,
        status,
        body: String(body || "").slice(0, 500),
        error: "",
      };
    } catch (error) {
      return {
        ok: false,
        skipped: false,
        status: 0,
        body: "",
        error: String(error?.message || error || "Webhook notify failed").slice(0, 300),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { notify };
}
