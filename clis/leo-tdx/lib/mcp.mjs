export function createMcpClient({
  token,
  url = "https://txmcp.tdx.com.cn:3001/txmcp",
  fetchImpl = fetch,
  timeoutMs = 60000,
} = {}) {
  let sessionId = null;
  let nextId = 0;

  async function request(method, params = null, notification = false) {
    const body = { jsonrpc: "2.0", method };
    if (params !== null) body.params = params;
    if (!notification) body.id = ++nextId;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw McpError.from(error);
    }
    if (!sessionId) sessionId = response.headers.get("Mcp-Session-Id");
    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw McpError.from(error);
    }
    if (!response.ok) throw new McpError(`TDX MCP HTTP ${response.status}`, response.status);
    try {
      return parseSse(text);
    } catch (error) {
      throw new McpError("TDX MCP returned an invalid response.", 4, { cause: error });
    }
  }

  return {
    async initialize() {
      const response = await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "leo-tdx", version: "1.0.0" },
      });
      await request("notifications/initialized", null, true);
      return response?.result?.serverInfo || response?.result || {};
    },
    async callTool(name, arguments_) {
      await this.initialize();
      const response = await request("tools/call", { name, arguments: arguments_ || {} });
      if (response?.error) throw new McpError(response.error.message || "TDX MCP tool call failed.", 4);
      return (response?.result?.content || [])
        .map((item) => item?.text || "")
        .join("");
    },
    async listTools() {
      await this.initialize();
      const response = await request("tools/list", {});
      return response?.result?.tools || [];
    },
    async callToolRaw(name, arguments_) {
      await this.initialize();
      return request("tools/call", { name, arguments: arguments_ || {} });
    },
  };
}

export class McpError extends Error {
  constructor(message, status = 0, options = {}) {
    super(message, options);
    const fromStatus = status === 401 || status === 403 ? 3 : status > 0 ? 4 : 0;
    this.exitCode = fromStatus || 4;
  }

  static from(error) {
    if (error instanceof McpError) return error;
    if (error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError) {
      const result = new McpError("TDX MCP network request failed.", 0, { cause: error });
      result.exitCode = 5;
      return result;
    }
    const result = new McpError(error?.message || "TDX MCP request failed.", 0, { cause: error });
    result.exitCode = 5;
    return result;
  }
}

export function parseSse(text) {
  const data = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  return data ? JSON.parse(data) : null;
}
