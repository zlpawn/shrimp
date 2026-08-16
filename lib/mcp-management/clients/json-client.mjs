export function createJsonClientAdapter({ id, label, defaultPath }) {
  return {
    id,
    label,
    defaultPath,
    scan(text) {
      let doc;
      try { doc = JSON.parse(String(text || "{}")); } catch { return { error: "invalid_json" }; }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { error: "invalid_root" };
      const raw = doc.mcpServers && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers)
        ? doc.mcpServers
        : {};
      const servers = new Map();
      for (const [name, config] of Object.entries(raw)) {
        const server = { name, transport: "remote", command: "", args: [], env: {}, headers: {}, url: "" };
        if (config && typeof config === "object" && !Array.isArray(config)) {
          if (typeof config.command === "string") { server.transport = "stdio"; server.command = config.command; }
          if (Array.isArray(config.args)) server.args = config.args.map((v) => String(v));
          if (typeof config.url === "string") { server.transport = "remote"; server.url = config.url; }
          if (config.env && typeof config.env === "object" && !Array.isArray(config.env)) server.env = { ...config.env };
          if (config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)) server.headers = { ...config.headers };
        }
        servers.set(name, server);
      }
      return servers;
    },
    merge(text, servers) {
      let doc;
      try { doc = JSON.parse(String(text || "{}")); } catch { throw new Error("目标文件不是合法 JSON，已取消写入"); }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("目标文件根节点不是对象，已取消写入");
      const mcpServers = { ...(doc.mcpServers && typeof doc.mcpServers === "object" ? doc.mcpServers : {}) };
      for (const server of servers) {
        const entry = {};
        if (server.transport === "stdio") {
          entry.command = server.command;
          if (server.args && server.args.length) entry.args = server.args;
          if (server.env && Object.keys(server.env).length) entry.env = { ...server.env };
        } else {
          entry.url = server.url;
          if (server.headers && Object.keys(server.headers).length) entry.headers = { ...server.headers };
        }
        mcpServers[server.name] = entry;
      }
      return JSON.stringify({ ...doc, mcpServers }, null, 2) + String.fromCharCode(10);
    },
    hint(path, servers) {
      const names = servers.map((s) => s.name).join(", ");
      return "编辑文件 " + path + "，在顶层 mcpServers 对象中添加 " + names + "。";
    },
  };
}

