import { normalizeDiscoveredModels } from "../normalize.mjs";
import { ensureReady, DEFAULT_WORKBUDDY_PORT } from "../../workbuddy/supervisor.mjs";

export const workbuddyStrategy = {
  id: "workbuddy",
  supports(endpoint) {
    const type = String(endpoint?.type || "").toLowerCase();
    const provider = String(endpoint?.provider || "").toLowerCase();
    const base = String(endpoint?.base_url || "");
    return type === "workbuddy" || provider === "workbuddy" || /:7863(?:\/|$)/.test(base);
  },
  async discover(endpoint, context = {}) {
    const rawBase = String(endpoint?.base_url || "").trim() || `http://127.0.0.1:${DEFAULT_WORKBUDDY_PORT}/v1`;
    let url;
    try {
      url = new URL(rawBase);
    } catch {
      url = new URL(`http://127.0.0.1:${DEFAULT_WORKBUDDY_PORT}/v1`);
    }

    const port = Number(url.port) || DEFAULT_WORKBUDDY_PORT;

    // Automatically ensure the workbuddy2api service is installed and running
    const ensureReadyFn = context.ensureReady || ensureReady;
    try {
      await ensureReadyFn({ port });
    } catch (err) {
      console.warn(`[WorkBuddyStrategy] ensureReady warning: ${err.message}`);
    }

    // Build models endpoint URL
    let pathname = (url.pathname || "").replace(/\/+$/, "");
    if (/\/models$/i.test(pathname)) {
      // already /models
    } else if (pathname) {
      pathname = `${pathname}/models`;
    } else {
      pathname = "/v1/models";
    }

    const modelsUrl = new URL(url.toString());
    modelsUrl.pathname = pathname;
    const requestUrl = modelsUrl.toString();

    const headers = {
      Accept: "application/json",
      ...(context.headers || {}),
    };

    const apiKey = context.apiKey || endpoint?.api_key || "";
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const fetchImpl = context.fetchImpl || globalThis.fetch;
    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: "GET",
        headers,
        signal: context.signal,
      });
    } catch (netErr) {
      const error = new Error(`无法连接到 WorkBuddy 服务 (${requestUrl}): ${netErr.message}`);
      error.code = "upstream_connect_error";
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`WorkBuddy 模型列表请求失败 (${response.status}) @ ${requestUrl}`);
      error.code = "upstream_http_error";
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    const models = normalizeDiscoveredModels(payload).map((m) => {
      // WorkBuddy models generally support reasoning and tools
      return {
        ...m,
        capabilities: {
          reasoning: true,
          tools: true,
          ...(m.capabilities || {}),
        },
      };
    });

    return {
      source: "workbuddy",
      strategy: "workbuddy",
      models,
      request_url: requestUrl,
    };
  },
};
