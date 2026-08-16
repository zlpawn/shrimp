import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodexReader } from "./codex-reader.mjs";
import { createClaudeReader } from "./claude-reader.mjs";
import { createAntigravityReader } from "./antigravity-reader.mjs";

export function getDefaultClientPaths() {
  return {
    codex: {
      id: "codex",
      name: "Codex",
      description: "Codex Desktop / CLI 会话索引与元数据文件",
      fields: [
        { key: "stateFile", label: "State SQLite 数据库", value: path.join(os.homedir(), ".codex", "state_5.sqlite") },
        { key: "indexFile", label: "Session Index 索引文件", value: path.join(os.homedir(), ".codex", "session_index.jsonl") },
        { key: "sessionsDir", label: "Sessions 目录", value: path.join(os.homedir(), ".codex", "sessions") },
      ],
    },
    claudeDesktop: {
      id: "claudeDesktop",
      name: "Claude Desktop",
      description: "Claude Desktop 桌面端应用会话",
      fields: [
        { key: "projectsDir", label: "Projects 目录", value: path.join(os.homedir(), ".claude", "projects") },
      ],
    },
    claudeCode: {
      id: "claudeCode",
      name: "Claude Code (CLI)",
      description: "Claude Code 终端命令行会话",
      fields: [
        { key: "projectsDir", label: "Projects 目录", value: path.join(os.homedir(), ".claude", "projects") },
      ],
    },
    antigravityDesktop: {
      id: "antigravityDesktop",
      name: "Antigravity 桌面版",
      description: "Antigravity 2.0 桌面端 IDE 会话",
      fields: [
        { key: "brainDir", label: "Brain 目录", value: path.join(os.homedir(), ".gemini", "antigravity", "brain") },
        { key: "conversationsDir", label: "Conversations 目录", value: path.join(os.homedir(), ".gemini", "antigravity", "conversations") },
      ],
    },
    antigravityCli: {
      id: "antigravityCli",
      name: "Antigravity CLI",
      description: "Antigravity CLI (agy) 终端会话",
      fields: [
        { key: "brainDir", label: "Brain 目录", value: path.join(os.homedir(), ".gemini", "antigravity-cli", "brain") },
        { key: "conversationsDir", label: "Conversations 目录", value: path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations") },
      ],
    },
  };
}

export function mergeClientPaths(custom = {}) {
  const defaults = getDefaultClientPaths();
  const result = {};
  for (const [clientId, def] of Object.entries(defaults)) {
    const customClient = custom?.[clientId] || {};
    const customFields = customClient.fields || {};
    result[clientId] = {
      ...def,
      fields: def.fields.map(field => {
        const customValue = typeof customFields === "object" && !Array.isArray(customFields)
          ? customFields[field.key]
          : Array.isArray(customFields)
            ? customFields.find(f => f.key === field.key)?.value
            : undefined;
        return {
          ...field,
          value: typeof customValue === "string" && customValue.trim() ? customValue.trim() : field.value,
        };
      }),
    };
  }
  return result;
}

export function annotatePathsExistence(pathsConfig) {
  const result = {};
  for (const [clientId, client] of Object.entries(pathsConfig)) {
    result[clientId] = {
      ...client,
      fields: client.fields.map(field => ({
        ...field,
        exists: fs.existsSync(field.value),
      })),
    };
  }
  return result;
}

export function buildReadersFromPathsConfig(pathsConfig) {
  const readers = [];
  const paths = pathsConfig || getDefaultClientPaths();

  // 1. Codex Reader
  const codexFields = Object.fromEntries(paths.codex.fields.map(f => [f.key, f.value]));
  readers.push(createCodexReader({
    stateFile: codexFields.stateFile,
    indexFile: codexFields.indexFile,
  }));

  // 2. Claude Desktop Reader
  const claudeDesktopFields = Object.fromEntries(paths.claudeDesktop.fields.map(f => [f.key, f.value]));
  readers.push(createClaudeReader({
    client: "claude",
    projectsDir: claudeDesktopFields.projectsDir,
    filterMode: "desktop",
  }));

  // 3. Claude Code Reader (if path exists or different)
  const claudeCodeFields = Object.fromEntries(paths.claudeCode.fields.map(f => [f.key, f.value]));
  readers.push(createClaudeReader({
    client: "claude",
    projectsDir: claudeCodeFields.projectsDir,
    filterMode: "code",
  }));

  // 4. Antigravity Desktop Reader
  const agDesktopFields = Object.fromEntries(paths.antigravityDesktop.fields.map(f => [f.key, f.value]));
  readers.push(createAntigravityReader({
    brainDirs: [agDesktopFields.brainDir],
  }));

  // 5. Antigravity CLI Reader
  const agCliFields = Object.fromEntries(paths.antigravityCli.fields.map(f => [f.key, f.value]));
  readers.push(createAntigravityReader({
    brainDirs: [agCliFields.brainDir],
  }));

  return readers;
}
