import path from "node:path";

function quote(value) {
  return JSON.stringify(String(value));
}

function stripComment(line) {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && !inSingle && (i === 0 || line[i - 1] !== "\\")) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "#" && !inDouble && !inSingle) return line.slice(0, i);
  }
  return line;
}

function unquote(value) {
  const s = String(value || "").trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

function splitLines(text) {
  return String(text || "").split(/\r?\n/);
}

function parseTomlArray(lines, startIndex) {
  const first = stripComment(lines[startIndex]);
  const eq = first.indexOf("=");
  if (eq < 0) return null;
  const value = first.slice(eq + 1).trim();
  const start = value.indexOf("[");
  if (start < 0) return null;
  let text = value.slice(start + 1);
  let i = startIndex;
  // Walk until a closing bracket outside strings and comments.
  for (;;) {
    let inDouble = false;
    let inSingle = false;
    for (let j = 0; j < text.length; j += 1) {
      const ch = text[j];
      if (ch === '"' && !inSingle && (j === 0 || text[j - 1] !== "\\")) inDouble = !inDouble;
      else if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === "]" && !inDouble && !inSingle) {
        const inner = text.slice(0, j).trim();
        return { value: parseArrayInner(inner), nextIndex: i + 1 };
      }
    }
    i += 1;
    if (i >= lines.length) return null;
    text += "\n" + stripComment(lines[i]);
  }
}

function parseArrayInner(inner) {
  if (!inner.trim()) return [];
  const out = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"' && !inSingle && (i === 0 || inner[i - 1] !== "\\")) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === "," && !inDouble && !inSingle) {
      if (current.trim()) out.push(unquote(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(unquote(current.trim()));
  return out;
}

function sectionName(line) {
  const s = stripComment(String(line || "")).trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return null;
  return s.slice(1, -1).trim();
}

function readKv(line) {
  const s = stripComment(String(line || ""));
  const idx = s.indexOf("=");
  if (idx <= 0) return null;
  const key = s.slice(0, idx).trim();
  const value = s.slice(idx + 1).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null;
  return [key, value];
}

function sectionCanFollow(section) {
  return String(section || "").startsWith("mcp_servers.");
}

export const codexAdapter = {
  id: "codex",
  label: "OpenAI Codex",
  defaultPath(home) {
    return path.join(home, ".codex", "config.toml");
  },
  scan(text) {
    const lines = splitLines(text);
    const servers = new Map();
    let current = null;
    let currentEnv = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const section = sectionName(line);
      if (section) {
        current = null;
        currentEnv = false;
        if (section.startsWith("mcp_servers.")) {
          const rest = section.slice("mcp_servers.".length);
          if (rest.endsWith(".env")) {
            const name = rest.slice(0, -4);
            if (servers.has(name)) { current = name; currentEnv = true; }
          } else if (rest && !rest.includes(".")) {
            if (!servers.has(rest)) {
              servers.set(rest, { name: rest, transport: "stdio", command: "", args: [], env: {}, url: "" });
            }
            current = rest;
          }
        }
        continue;
      }
      if (!current) continue;
      const kv = readKv(line);
      if (!kv) continue;
      const key = kv[0];
      const raw = kv[1];
      const server = servers.get(current);
      if (currentEnv) {
        server.env = server.env || {};
        server.env[key] = unquote(raw);
      } else if (key === "command") {
        server.command = unquote(raw);
        server.transport = "stdio";
      } else if (key === "url") {
        server.url = unquote(raw);
        server.transport = "remote";
      } else if (key === "args") {
        const parsed = parseTomlArray(lines, i);
        if (parsed) {
          server.args = parsed.value;
          i = parsed.nextIndex - 1;
        }
      } else if (key === "enabled") {
        server.enabled = raw === "true";
      } else if (key === "startup_timeout_sec") {
        server.startup_timeout_sec = Number(raw) || undefined;
      }
    }
    return servers;
  },
  merge(text, servers) {
    const lines = splitLines(text);
    const managed = new Set();
    for (const server of servers) {
      managed.add("mcp_servers." + server.name);
      managed.add("mcp_servers." + server.name + ".env");
    }
    const kept = [];
    let i = 0;
    while (i < lines.length) {
      const section = sectionName(lines[i]);
      if (section && managed.has(section)) {
        i += 1;
        while (i < lines.length && !sectionName(lines[i])) i += 1;
        continue;
      }
      kept.push(lines[i]);
      i += 1;
    }
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();

    const blocks = [];
    for (const server of servers) {
      const linesOut = [];
      if (server.transport === "remote") {
        linesOut.push("[mcp_servers." + server.name + "]");
        linesOut.push("enabled = " + (server.enabled === false ? "false" : "true"));
        linesOut.push("url = " + quote(server.url));
      } else {
        linesOut.push("[mcp_servers." + server.name + "]");
        linesOut.push("command = " + quote(server.command));
        if (server.args && server.args.length) {
          linesOut.push("args = [" + server.args.map((v) => quote(v)).join(", ") + "]");
        }
        if (server.env && Object.keys(server.env).length) {
          linesOut.push("");
          linesOut.push("[mcp_servers." + server.name + ".env]");
          for (const [key, value] of Object.entries(server.env)) {
            linesOut.push(key + " = " + quote(value));
          }
        }
      }
      blocks.push(linesOut.join("\n"));
    }

    const body = kept.join("\n").replace(/\n+$/, "");
    const appended = blocks.join("\n\n");
    if (!body) return appended + "\n";
    return body + "\n\n" + appended + "\n";
  },
  hint(path, servers) {
    const names = servers.map((s) => s.name).join(", ");
    return "编辑文件 " + path + "，在末尾追加 " + names + " 对应的 [mcp_servers.<name>] 区块。";
  },
};

export function codexSectionCanFollow(section) {
  return sectionCanFollow(section);
}

