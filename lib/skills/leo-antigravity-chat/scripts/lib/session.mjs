import fs from "node:fs";
import path from "node:path";
import { resolveSessionsDir } from "./config.mjs";

export function sanitizeSessionId(raw = "") {
  const clean = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!clean) {
    throw new Error("无效的 session ID，请使用字母、数字、下划线或短横线。");
  }
  return clean.slice(0, 80);
}

export function resolveSessionPath(sessionId, env = process.env) {
  const safeId = sanitizeSessionId(sessionId);
  return path.join(resolveSessionsDir(env), `${safeId}.json`);
}

export function loadSession(sessionId, env = process.env) {
  const safeId = sanitizeSessionId(sessionId);
  const filePath = resolveSessionPath(safeId, env);
  if (!fs.existsSync(filePath)) {
    return {
      id: safeId,
      model: "",
      system: "",
      turns: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) || {};
    return {
      id: safeId,
      model: typeof data.model === "string" ? data.model : "",
      system: typeof data.system === "string" ? data.system : "",
      turns: Array.isArray(data.turns) ? data.turns : [],
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`读取会话 ${safeId} 失败: ${err.message}`);
  }
}

export function saveSession(session, env = process.env) {
  const safeId = sanitizeSessionId(session.id);
  const filePath = resolveSessionPath(safeId, env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(
    {
      id: safeId,
      model: session.model || "",
      system: session.system || "",
      turns: Array.isArray(session.turns) ? session.turns : [],
      created_at: session.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    fs.writeFileSync(filePath, payload, { encoding: "utf8", mode: 0o600 });
    try { fs.unlinkSync(tmpPath); } catch {}
  }
  if (process.platform !== "win32") {
    try { fs.chmodSync(filePath, 0o600); } catch {}
  }
  return filePath;
}

export function listSessions(env = process.env) {
  const dir = resolveSessionsDir(env);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const id = entry.name.slice(0, -5);
    try {
      const s = loadSession(id, env);
      out.push({
        id: s.id,
        model: s.model,
        turn_count: s.turns.length,
        updated_at: s.updated_at,
      });
    } catch {
      // skip corrupted entry
    }
  }
  out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return out;
}

export function clearSession(sessionId = "", env = process.env) {
  const dir = resolveSessionsDir(env);
  if (!sessionId) {
    if (!fs.existsSync(dir)) return 0;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
    return files.length;
  }
  const filePath = resolveSessionPath(sessionId, env);
  if (!fs.existsSync(filePath)) return 0;
  fs.rmSync(filePath, { force: true });
  return 1;
}
