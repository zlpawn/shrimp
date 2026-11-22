import { normalizeDiscoveredModels } from "../normalize.mjs";
import {
  ensureReady,
  readOfmForwardKey,
  DEFAULT_OFM_PORT,
} from "../../ofm/supervisor.mjs";

export const ofmStrategy = {
  id: "ofm",
  supports(endpoint) {
    const type = String(endpoint?.type || "").toLowerCase();
    const provider = String(endpoint?.provider || "").toLowerCase();
    const base = String(endpoint?.base_url || "");
    return type === "ofm" || provider === "ofm" || /:18900(?:\/|$)/.test(base);
  },
  async discover(endpoint, context = {}) {
    const rawBase = String(endpoint?.base_url || "").trim() || `http://127.0.0.1:${DEFAULT_OFM_PORT}/v1`;
    let url;
    try {
      url = new URL(rawBase);
    } catch {
      url = new URL(`http://127.0.0.1:${DEFAULT_OFM_PORT}/v1`);
    }

    const port = Number(url.port) || DEFAULT_OFM_PORT;
    const ensureReadyFn = context.ensureReady || ensureReady;
    try {
      await ensureReadyFn({ port });
    } catch (err) {
      console.warn(`[OfmStrategy] ensureReady warning: ${err.message}`);
    }

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

    const apiKey = readOfmForwardKey() || context.apiKey || endpoint?.api_key || "";
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
      const error = new Error(`无法连接到 OFM 服务 (${requestUrl}): ${netErr.message}`);
      error.code = "upstream_connect_error";
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`OFM 模型列表请求失败 (${response.status}) @ ${requestUrl}`);
      error.code = "upstream_http_error";
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    const models = normalizeDiscoveredModels(payload).map((m) => ({
      ...m,
      capabilities: {
        reasoning: true,
        tools: true,
        ...(m.capabilities || {}),
      },
    }));

    return {
      source: "ofm",
      strategy: "ofm",
      models,
      request_url: requestUrl,
    };
  },
};
