import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanSessionTitle } from "./codex-reader.mjs";

export function createAntigravityReader({
  brainDir = path.join(os.homedir(), ".gemini", "antigravity", "brain"),
} = {}) {
  return {
    async list() {
      if (!fs.existsSync(brainDir)) return [];
      const sessions = [];
      for (const entry of fs.readdirSync(brainDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const transcript = path.join(brainDir, entry.name, ".system_generated", "logs", "transcript.jsonl");
        if (!fs.existsSync(transcript)) continue;
        let title = "";
        let objective = "";
        let lastActivityAt = null;
        for (const line of fs.readFileSync(transcript, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            const activityTime = item.created_at || item.timestamp;
            if (activityTime) lastActivityAt = activityTime;
            if (!title && item.type === "USER_INPUT" && item.content) title = cleanSessionTitle(item.content);
            if (item.type === "CHECKPOINT" && item.content) {
              const match = String(item.content).match(/#\s*USER Objective:\s*([^\n\r]+)/i);
              if (match?.[1]) objective = match[1].trim();
            }
          } catch {}
        }
        if (!lastActivityAt) continue;
        sessions.push({
          client: "antigravity",
          id: entry.name,
          dispatchTarget: entry.name,
          title: cleanSessionTitle(objective || title || entry.name),
          workspacePath: "",
          createdAt: lastActivityAt,
          lastActivityAt,
          archived: false,
          sourcePath: transcript,
        });
      }
      return sessions.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
    },
  };
}
