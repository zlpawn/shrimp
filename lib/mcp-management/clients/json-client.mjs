export function createJsonClientAdapter({
  id,
  label,
  defaultPath,
  listKey = "mcpServers",
  entryFormat = "object",
}) {
  return {
    id,
    label,
    defaultPath,
    listKey,
    scan(text) {
      let doc;
      try { doc = JSON.parse(String(text || "{}")); } catch { return { error: "invalid_json" }; }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { error: "invalid_root" };

      const configuredList = doc[listKey];
      const current = configuredList !== undefined ? configuredList : doc.mcpServers;
      const configs = Array.isArray(current)
        ? current
        : current && typeof current === "object"
          ? Object.entries(current).map(([name, config]) => ({ name, ...config }))
          : [];
      const servers = new Map();
      for (const config of configs) {
        if (!config || typeof config !== "object" || Array.isArray(config)) continue;
        const name = String(config.name || "");
        if (!name) continue;
        const server = { name, transport: "remote", command: "", args: [], env: {}, headers: {}, url: "" };
        if (typeof config.command === "string") { server.transport = "stdio"; server.command = config.command; }
        if (Array.isArray(config.args)) server.args = config.args.map((value) => String(value));
        if (typeof config.url === "string") { server.transport = "remote"; server.url = config.url; }
        if (config.env && typeof config.env === "object" && !Array.isArray(config.env)) server.env = { ...config.env };
        if (config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)) server.headers = { ...config.headers };
        servers.set(name, server);
      }
      return servers;
    },
    merge(text, servers) {
      let doc;
      try { doc = JSON.parse(String(text || "{}")); } catch { throw new Error("目标文件不是合法 JSON，已取消写入"); }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("目标文件根节点不是对象，已取消写入");

      const configuredList = doc[listKey];
      const current = configuredList !== undefined ? configuredList : doc.mcpServers;
      const useArray = Array.isArray(current) || (current === undefined && entryFormat === "array");
      if (!useArray) {
        const mcpServers = {};
        const objectEntries = current && typeof current === "object" && !Array.isArray(current)
          ? Object.entries(current)
          : [];
        for (const [name, entry] of objectEntries) mcpServers[name] = { ...entry };
        for (const server of servers) {
          const entry = {};
          if (server.transport === "stdio") {
            entry.command = server.command;
            if (server.args && server.args.length) entry.args = [...server.args];
            if (server.env && Object.keys(server.env).length) entry.env = { ...server.env };
          } else {
            entry.url = server.url;
            if (server.headers && Object.keys(server.headers).length) entry.headers = { ...server.headers };
          }
          mcpServers[server.name] = entry;
        }
        return JSON.stringify({ ...doc, mcpServers: mcpServers }, null, 2) + String.fromCharCode(10);
      }

      const entries = Array.isArray(current)
        ? current.map((entry) => ({ ...entry }))
        : [];
      if (entryFormat === "object") {
        const mcpServers = {};
        for (const entry of entries) mcpServers[String(entry.name)] = { ...entry };
        for (const server of servers) {
          const entry = {};
          if (server.transport === "stdio") {
            entry.command = server.command;
            if (server.args && server.args.length) entry.args = [...server.args];
            if (server.env && Object.keys(server.env).length) entry.env = { ...server.env };
          } else {
            entry.url = server.url;
            if (server.headers && Object.keys(server.headers).length) entry.headers = { ...server.headers };
          }
          mcpServers[server.name] = entry;
        }
        return JSON.stringify({ ...doc, [listKey]: mcpServers }, null, 2) + String.fromCharCode(10);
      }

      const managedNames = new Set(servers.map((server) => server.name));
      const mergedEntries = entries.filter((entry) => !managedNames.has(String(entry.name)));
      for (const server of servers) {
        const entry = { name: server.name, transport: server.transport === "remote" ? "http" : "stdio" };
        if (server.transport === "stdio") {
          entry.command = server.command;
          if (server.args && server.args.length) entry.args = [...server.args];
          if (server.env && Object.keys(server.env).length) entry.env = { ...server.env };
        } else {
          entry.url = server.url;
          if (server.headers && Object.keys(server.headers).length) entry.headers = { ...server.headers };
        }
        mergedEntries.push(entry);
      }
      return JSON.stringify({ ...doc, [listKey]: mergedEntries }, null, 2) + String.fromCharCode(10);
    },
    formatSnippet(servers) {
      if (entryFormat === "array") {
        const serialize = (server) => {
          const entry = { name: server.name, transport: server.transport === "remote" ? "http" : "stdio" };
          if (server.transport === "stdio") {
            entry.command = server.command;
            if (server.args && server.args.length) entry.args = [...server.args];
            if (server.env && Object.keys(server.env).length) entry.env = { ...server.env };
          } else {
            entry.url = server.url;
            if (server.headers && Object.keys(server.headers).length) entry.headers = { ...server.headers };
          }
          return entry;
        };
        const entries = servers.map(serialize);
        return JSON.stringify({ [listKey]: entries }, null, 2) + String.fromCharCode(10);
      }

      const mcpServers = {};
      for (const server of servers) {
        const entry = {};
        if (server.transport === "stdio") {
          entry.command = server.command;
          if (server.args && server.args.length) entry.args = [...server.args];
          if (server.env && Object.keys(server.env).length) entry.env = { ...server.env };
        } else {
          entry.url = server.url;
          if (server.headers && Object.keys(server.headers).length) entry.headers = { ...server.headers };
        }
        mcpServers[server.name] = entry;
      }
      return JSON.stringify({ [listKey]: mcpServers }, null, 2) + String.fromCharCode(10);
    },
    hint(path, servers) {
      const names = servers.map((s) => s.name).join(", ");
      const containerDesc = entryFormat === "array" ? "列表中" : "对象中";
      return "编辑文件 " + path + "，在顶层 " + listKey + " " + containerDesc + "添加 " + names + "。";
    },
  };
}
