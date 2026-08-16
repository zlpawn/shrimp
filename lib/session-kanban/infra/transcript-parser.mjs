import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanSessionTitle } from "./codex-reader.mjs";
import { getDefaultClientPaths, mergeClientPaths } from "./paths-config.mjs";

function cleanUserContent(content) {
  const str = String(content || "");
  const match = str.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (match?.[1]) return match[1].trim();
  return str.replace(/<[^>]+>/g, "").trim();
}

function parseAntigravityTranscript(transcriptPath, sessionId) {
  if (!fs.existsSync(transcriptPath)) return null;
  const messages = [];
  let title = "";
  let workspacePath = "";
  let lastActivityAt = null;

  for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      const time = item.created_at || item.timestamp || "";
      if (time) lastActivityAt = time;

      if (item.type === "USER_INPUT" && item.content) {
        const text = cleanUserContent(item.content);
        if (text) {
          if (!title) title = cleanSessionTitle(text);
          messages.push({
            id: `step-${item.step_index ?? messages.length}`,
            role: "user",
            content: text,
            timestamp: time,
          });
        }
      } else if (item.type === "PLANNER_RESPONSE" || item.source === "MODEL") {
        const text = String(item.content || "").trim();
        const tools = [];
        if (Array.isArray(item.tool_calls)) {
          for (const tc of item.tool_calls) {
            const name = tc.name || "tool";
            const summary = tc.args?.toolSummary || tc.args?.toolAction || tc.args?.summary || "";
            const detail = tc.args?.CommandLine || tc.args?.TargetFile || tc.args?.AbsolutePath || (tc.args ? JSON.stringify(tc.args) : "");
            tools.push({ name, summary, detail: String(detail || "").slice(0, 500) });
          }
        }
        if (text || tools.length > 0) {
          messages.push({
            id: `step-${item.step_index ?? messages.length}`,
            role: "assistant",
            content: text,
            timestamp: time,
            tools: tools.length > 0 ? tools : undefined,
          });
        }
      }
    } catch {}
  }

  return {
    sessionId,
    client: "antigravity",
    title: title || sessionId,
    workspacePath,
    lastActivityAt,
    messages,
  };
}

function parseCodexRollout(rolloutPath, sessionId) {
  if (!fs.existsSync(rolloutPath)) return null;
  const messages = [];
  let title = "";
  let workspacePath = "";
  let lastActivityAt = null;
  let pendingTools = [];

  for (const line of fs.readFileSync(rolloutPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      const time = item.timestamp || "";
      if (time) lastActivityAt = time;

      if (item.type === "session_meta" && item.payload?.cwd) {
        workspacePath = item.payload.cwd;
      }

      if (item.type === "response_item" && item.payload?.type === "function_call") {
        const name = item.payload.name || "function_call";
        let summary = "";
        let detail = "";
        try {
          const args = typeof item.payload.arguments === "string" ? JSON.parse(item.payload.arguments) : item.payload.arguments;
          summary = args?.cmd || args?.path || args?.file_path || args?.pattern || args?.query || "";
          detail = typeof item.payload.arguments === "string" ? item.payload.arguments : JSON.stringify(item.payload.arguments);
        } catch {
          detail = String(item.payload.arguments || "");
        }
        pendingTools.push({ name, summary: String(summary || "").slice(0, 100), detail: String(detail || "").slice(0, 500) });
      }

      if (item.type === "event_msg") {
        const ptype = item.payload?.type;
        const msg = item.payload?.message;
        if (ptype === "user_message" && msg) {
          const text = String(msg).trim();
          if (!title) title = cleanSessionTitle(text);
          messages.push({
            id: `msg-${messages.length}`,
            role: "user",
            content: text,
            timestamp: time,
          });
        } else if (ptype === "agent_message" && msg) {
          const text = String(msg).trim();
          const tools = pendingTools;
          pendingTools = [];
          messages.push({
            id: `msg-${messages.length}`,
            role: "assistant",
            content: text,
            timestamp: time,
            tools: tools.length > 0 ? tools : undefined,
          });
        }
      }
    } catch {}
  }

  // If leftover tools at end of session
  if (pendingTools.length > 0 && messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages[messages.length - 1].tools = [...(messages[messages.length - 1].tools || []), ...pendingTools];
  }

  return {
    sessionId,
    client: "codex",
    title: title || sessionId,
    workspacePath,
    lastActivityAt,
    messages,
  };
}

function parseClaudeJsonl(filePath, sessionId) {
  if (!fs.existsSync(filePath)) return null;
  const messages = [];
  let title = "";
  let workspacePath = "";
  let lastActivityAt = null;

  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      const time = item.timestamp || "";
      if (time) lastActivityAt = time;
      if (item.cwd) workspacePath = item.cwd;
      if (item.type === "custom-title" && item.customTitle) title = String(item.customTitle);

      if (item.type === "user" && item.message?.content) {
        const raw = item.message.content;
        const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map(p => p?.text || "").filter(Boolean).join(" ") : "";
        if (text.trim()) {
          if (!title) title = cleanSessionTitle(text);
          messages.push({
            id: `claude-${messages.length}`,
            role: "user",
            content: text.trim(),
            timestamp: time,
          });
        }
      } else if (item.type === "assistant" && item.message?.content) {
        const raw = item.message.content;
        let text = "";
        const tools = [];
        if (typeof raw === "string") {
          text = raw;
        } else if (Array.isArray(raw)) {
          for (const part of raw) {
            if (part?.type === "text" && part.text) text += (text ? "\n" : "") + part.text;
            if (part?.type === "tool_use") {
              const name = part.name || "tool";
              const summary = part.input?.command || part.input?.path || part.input?.file_path || "";
              const detail = part.input ? JSON.stringify(part.input) : "";
              tools.push({ name, summary: String(summary || "").slice(0, 100), detail: String(detail || "").slice(0, 500) });
            }
          }
        }
        if (text.trim() || tools.length > 0) {
          messages.push({
            id: `claude-${messages.length}`,
            role: "assistant",
            content: text.trim(),
            timestamp: time,
            tools: tools.length > 0 ? tools : undefined,
          });
        }
      }
    } catch {}
  }

  return {
    sessionId,
    client: "claude",
    title: title || sessionId,
    workspacePath,
    lastActivityAt,
    messages,
  };
}

export function getSessionTranscript(sessionId, { customPaths } = {}) {
  const config = mergeClientPaths(customPaths);

  // 1. Try Antigravity (Desktop & CLI)
  const agBrainDirs = [
    config.antigravityDesktop.fields.find(f => f.key === "brainDir")?.value,
    config.antigravityCli.fields.find(f => f.key === "brainDir")?.value,
    path.join(os.homedir(), ".gemini", "antigravity", "brain"),
    path.join(os.homedir(), ".gemini", "antigravity-cli", "brain"),
  ].filter(Boolean);

  for (const bdir of agBrainDirs) {
    const transcriptPath = path.join(bdir, sessionId, ".system_generated", "logs", "transcript.jsonl");
    const parsed = parseAntigravityTranscript(transcriptPath, sessionId);
    if (parsed && parsed.messages.length > 0) return parsed;
  }

  // 2. Try Codex (Sessions Directory walk)
  const codexDir = config.codex.fields.find(f => f.key === "sessionsDir")?.value || path.join(os.homedir(), ".codex", "sessions");
  if (fs.existsSync(codexDir)) {
    function findRollout(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findRollout(full);
          if (found) return found;
        } else if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
          return full;
        }
      }
      return null;
    }
    const rolloutFile = findRollout(codexDir);
    if (rolloutFile) {
      const parsed = parseCodexRollout(rolloutFile, sessionId);
      if (parsed) return parsed;
    }
  }

  // 3. Try Claude Projects
  const claudeDirs = [
    config.claudeDesktop.fields.find(f => f.key === "projectsDir")?.value,
    config.claudeCode.fields.find(f => f.key === "projectsDir")?.value,
    path.join(os.homedir(), ".claude", "projects"),
  ].filter(Boolean);

  for (const cdir of claudeDirs) {
    if (!fs.existsSync(cdir)) continue;
    function findClaude(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findClaude(full);
          if (found) return found;
        } else if (entry.isFile() && (entry.name === `${sessionId}.jsonl` || entry.name.includes(sessionId))) {
          return full;
        }
      }
      return null;
    }
    const claudeFile = findClaude(cdir);
    if (claudeFile) {
      const parsed = parseClaudeJsonl(claudeFile, sessionId);
      if (parsed) return parsed;
    }
  }

  return {
    sessionId,
    client: "unknown",
    title: sessionId,
    workspacePath: "",
    lastActivityAt: null,
    messages: [],
  };
}
