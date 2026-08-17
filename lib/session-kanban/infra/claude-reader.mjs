import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanSessionTitle } from "./codex-reader.mjs";

function walkJsonl(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(fullPath, result);
    else if (entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.startsWith("agent-")) result.push(fullPath);
  }
  return result;
}

function messageText(item) {
  const content = item?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => typeof part === "string" ? part : part?.text || "").filter(Boolean).join(" ");
  return "";
}

export function createClaudeReader({
  client = "claude",
  projectsDir = path.join(os.homedir(), ".claude", "projects"),
  filterMode = "desktop",
} = {}) {
  return {
    async list() {
      const sessions = [];
      for (const filePath of walkJsonl(projectsDir)) {
        const id = path.basename(filePath, ".jsonl");
        let title = "";
        let workspacePath = "";
        let lastActivityAt = null;
        let isDesktop = false;
        let customTitle = "";
        for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            if (item.timestamp) lastActivityAt = item.timestamp;
            if (item.cwd) workspacePath = item.cwd;
            if (item.entrypoint && String(item.entrypoint).toLowerCase().includes("desktop")) isDesktop = true;
            if (item.type === "custom-title" && item.customTitle) customTitle = String(item.customTitle);
            if (!title && item.type === "user") title = messageText(item).slice(0, 120);
          } catch {}
        }
        if (!lastActivityAt) continue;
        if (filterMode === "desktop" && !isDesktop) continue;
        if (filterMode === "code" && isDesktop) continue;
        sessions.push({
          client,
          id,
          dispatchTarget: id,
          title: cleanSessionTitle(customTitle || title || id),
          workspacePath,
          createdAt: lastActivityAt,
          lastActivityAt,
          archived: false,
          sourcePath: filePath,
        });
      }
      return sessions.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
    },
  };
}
