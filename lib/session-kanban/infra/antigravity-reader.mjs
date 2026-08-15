import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
        let lastActivityAt = null;
        for (const line of fs.readFileSync(transcript, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            if (item.timestamp) lastActivityAt = item.timestamp;
            if (!title && item.type === "USER_INPUT" && item.content) title = String(item.content).slice(0, 120);
          } catch {}
        }
        if (!lastActivityAt) continue;
        sessions.push({
          client: "antigravity",
          id: entry.name,
          dispatchTarget: entry.name,
          title: title || entry.name,
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
