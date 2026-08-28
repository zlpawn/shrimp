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
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!sessionId) sessionId = response.headers.get("Mcp-Session-Id");
    if (!response.ok) throw new Error(`TDX MCP HTTP ${response.status}`);
    return parseSse(await response.text());
  }

  return {
    async callTool(name, arguments_) {
      await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "leo-tdx", version: "1.0.0" },
      });
      await request("notifications/initialized", null, true);
      const response = await request("tools/call", { name, arguments: arguments_ || {} });
      if (response?.error) throw new Error(response.error.message || "TDX MCP tool call failed.");
      return (response?.result?.content || [])
        .map((item) => item?.text || "")
        .join("");
    },
    async listTools() {
      await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "leo-tdx", version: "1.0.0" },
      });
      await request("notifications/initialized", null, true);
      const response = await request("tools/list", {});
      return response?.result?.tools || [];
    },
  };
}

export function parseSse(text) {
  const data = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  return data ? JSON.parse(data) : null;
}
