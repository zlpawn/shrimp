// Read-only Antigravity conversation inspector (filesystem + sqlite).
// cascade_id is treated as the host conversation id.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { defaultAntigravityPaths } from "./project-store.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeStat(statSync, target) {
  try {
    return statSync(target);
  } catch {
    return null;
  }
}

function extractUserRequest(content) {
  const text = String(content || "");
  const match = text.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  return match ? match[1].trim() : "";
}

function extractModelSelection(content) {
  const text = String(content || "");
  const match = text.match(
    /Model Selection`?\s+from\s+.+?\s+to\s+([^\n<]+?)(?:\.\s|\.?\s*$|\s*<)/i,
  );
  return match ? match[1].trim().replace(/\.$/, "") : "";
}

function extractWorkspaceUri(blob) {
  if (!blob) return "";
  try {
    let text = "";
    if (typeof blob === "string") {
      text = blob;
    } else if (Buffer.isBuffer(blob)) {
      text = blob.toString("utf8");
    } else if (blob instanceof Uint8Array) {
      text = Buffer.from(blob).toString("utf8");
    } else if (ArrayBuffer.isView(blob)) {
      text = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength).toString(
        "utf8",
      );
    } else {
      text = String(blob);
    }
    const match = text.match(/file:\/\/\/[^\u0000-\u001f"']+/);
    return match ? match[0] : "";
  } catch {
    return "";
  }
}

function fileUriToPath(fileUri) {
  const raw = String(fileUri || "").trim();
  if (!raw) return "";
  try {
    if (raw.startsWith("file:")) {
      const u = new URL(raw);
      let p = decodeURIComponent(u.pathname || "");
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return p.replace(/\//g, path.sep);
    }
  } catch {
    // fall through
  }
  return raw;
}

function readTranscriptEntries({
  transcriptPath,
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
  limit = 0,
} = {}) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let text = "";
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }

  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      entries.push({
        stepIndex: Number(parsed?.step_index ?? entries.length),
        source: String(parsed?.source || ""),
        type: String(parsed?.type || ""),
        status: String(parsed?.status || ""),
        createdAt: parsed?.created_at || null,
        content: String(parsed?.content || ""),
        thinking: parsed?.thinking ? String(parsed.thinking) : "",
      });
    } catch {
      // skip invalid transcript lines
    }
  }

  if (limit > 0 && entries.length > limit) {
    return entries.slice(-limit);
  }
  return entries;
}

function openReadonlyDb(dbPath, openDatabase = null) {
  if (typeof openDatabase === "function") {
    return openDatabase(dbPath);
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}

function readConversationMetaFromDb(dbPath, { openDatabase = null } = {}) {
  let db = null;
  try {
    db = openReadonlyDb(dbPath, openDatabase);
    const meta =
      db
        .prepare(
          "SELECT cascade_id, trajectory_id, trajectory_type, source FROM trajectory_meta LIMIT 1",
        )
        .get() || {};
    const stepCount =
      db.prepare("SELECT COUNT(*) AS n FROM steps").get()?.n || 0;
    let workspaceUri = "";
    try {
      const blob =
        db
          .prepare(
            "SELECT data FROM trajectory_metadata_blob WHERE id = 'main' LIMIT 1",
          )
          .get()?.data || null;
      workspaceUri = extractWorkspaceUri(blob);
    } catch {
      workspaceUri = "";
    }
    return {
      cascadeId: String(meta.cascade_id || path.basename(dbPath, ".db")),
      trajectoryId: String(meta.trajectory_id || ""),
      trajectoryType: meta.trajectory_type ?? null,
      source: meta.source ?? null,
      stepCount: Number(stepCount) || 0,
      workspaceUri,
      workspacePath: fileUriToPath(workspaceUri),
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close?.();
    } catch {
      // ignore close errors
    }
  }
}

export function defaultBrainDir(env = process.env) {
  const home = env.USERPROFILE || env.HOME || "";
  return path.join(home, ".gemini", "antigravity", "brain");
}

export function resolveConversationPaths({
  cascadeId,
  conversationsDir = "",
  brainDir = "",
  paths = null,
} = {}) {
  const defaults = paths || defaultAntigravityPaths();
  const id = String(cascadeId || "").trim();
  const convDir = conversationsDir || defaults.conversationsDir;
  const brainRoot = brainDir || defaultBrainDir();
  return {
    cascadeId: id,
    dbPath: id ? path.join(convDir, `${id}.db`) : "",
    brainDir: id ? path.join(brainRoot, id) : "",
    transcriptPath: id
      ? path.join(
          brainRoot,
          id,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        )
      : "",
  };
}

export function listConversationsFromStore({
  conversationsDir = defaultAntigravityPaths().conversationsDir,
  brainDir = defaultBrainDir(),
  limit = 20,
  readdirSync = fs.readdirSync,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
  readFileSync = fs.readFileSync,
  openDatabase = null,
} = {}) {
  if (!conversationsDir || !existsSync(conversationsDir)) return [];

  let names = [];
  try {
    names = readdirSync(conversationsDir);
  } catch {
    return [];
  }

  const items = [];
  for (const name of names) {
    if (!String(name).toLowerCase().endsWith(".db")) continue;
    const cascadeId = path.basename(String(name), ".db");
    if (!UUID_RE.test(cascadeId)) continue;
    const dbPath = path.join(conversationsDir, name);
    const st = safeStat(statSync, dbPath);
    if (!st || !st.isFile?.()) continue;

    const resolved = resolveConversationPaths({
      cascadeId,
      conversationsDir,
      brainDir,
    });
    const meta =
      readConversationMetaFromDb(dbPath, { openDatabase }) || {
        cascadeId,
        trajectoryId: "",
        trajectoryType: null,
        source: null,
        stepCount: 0,
        workspaceUri: "",
        workspacePath: "",
      };

    const transcriptExists = existsSync(resolved.transcriptPath);
    const transcriptEntries = transcriptExists
      ? readTranscriptEntries({
          transcriptPath: resolved.transcriptPath,
          readFileSync,
          existsSync,
          limit: 8,
        })
      : [];

    const userEntry = transcriptEntries.find(
      (entry) => entry.type === "USER_INPUT" || entry.source === "USER_EXPLICIT",
    );
    const assistantEntry = [...transcriptEntries]
      .reverse()
      .find(
        (entry) =>
          entry.type === "PLANNER_RESPONSE" ||
          entry.source === "MODEL" ||
          entry.type === "MODEL_RESPONSE",
      );

    const preview =
      extractUserRequest(userEntry?.content) ||
      String(userEntry?.content || "").slice(0, 120);
    const model =
      extractModelSelection(userEntry?.content) ||
      extractModelSelection(assistantEntry?.content) ||
      "";

    items.push({
      id: cascadeId,
      cascadeId,
      conversationId: cascadeId,
      trajectoryId: meta.trajectoryId || "",
      title: preview || `conversation ${cascadeId.slice(0, 8)}`,
      preview: preview || "",
      model,
      workspacePath: meta.workspacePath || "",
      workspaceUri: meta.workspaceUri || "",
      stepCount: meta.stepCount || transcriptEntries.length || 0,
      transcriptAvailable: transcriptExists,
      dbPath,
      transcriptPath: resolved.transcriptPath,
      updatedAt: st.mtimeMs || st.mtime?.getTime?.() || null,
      createdAt: st.birthtimeMs || st.ctimeMs || null,
      source: "filesystem-conversation-store",
    });
  }

  items.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const n = Math.max(0, Number(limit) || 0);
  return n > 0 ? items.slice(0, n) : items;
}

export function getConversationFromStore({
  cascadeId,
  conversationsDir = defaultAntigravityPaths().conversationsDir,
  brainDir = defaultBrainDir(),
  transcriptLimit = 50,
  readdirSync = fs.readdirSync,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
  readFileSync = fs.readFileSync,
  openDatabase = null,
} = {}) {
  const id = String(cascadeId || "").trim();
  if (!id) return null;

  const resolved = resolveConversationPaths({
    cascadeId: id,
    conversationsDir,
    brainDir,
  });
  if (!resolved.dbPath || !existsSync(resolved.dbPath)) {
    if (!existsSync(resolved.transcriptPath)) return null;
  }

  const listed = listConversationsFromStore({
    conversationsDir,
    brainDir,
    limit: 0,
    readdirSync,
    existsSync,
    statSync,
    readFileSync,
    openDatabase,
  });
  const summary =
    listed.find((item) => item.cascadeId === id) ||
    {
      id,
      cascadeId: id,
      conversationId: id,
      trajectoryId: "",
      title: `conversation ${id.slice(0, 8)}`,
      preview: "",
      model: "",
      workspacePath: "",
      workspaceUri: "",
      stepCount: 0,
      transcriptAvailable: existsSync(resolved.transcriptPath),
      dbPath: resolved.dbPath,
      transcriptPath: resolved.transcriptPath,
      updatedAt: null,
      createdAt: null,
      source: "filesystem-conversation-store",
    };

  const transcript = readTranscriptEntries({
    transcriptPath: resolved.transcriptPath,
    readFileSync,
    existsSync,
    limit: transcriptLimit,
  });

  const events = transcript.map((entry, index) => {
    const userText = extractUserRequest(entry.content);
    let type = "host_step";
    let text = entry.content;
    if (entry.type === "USER_INPUT" || entry.source === "USER_EXPLICIT") {
      type = "user_text";
      text = userText || entry.content;
    } else if (
      entry.type === "PLANNER_RESPONSE" ||
      entry.source === "MODEL" ||
      entry.type === "MODEL_RESPONSE"
    ) {
      type = "assistant_text";
      text = entry.content;
    } else if (entry.type === "CHECKPOINT") {
      type = "checkpoint";
    }
    return {
      seq: index + 1,
      type,
      stepIndex: entry.stepIndex,
      source: entry.source,
      hostType: entry.type,
      status: entry.status,
      createdAt: entry.createdAt,
      text,
      thinking: entry.thinking || "",
    };
  });

  return {
    ...summary,
    status: "offline_readonly",
    mode: "inspect",
    eventCount: events.length,
    latestSeq: events.length,
    pendingApprovals: [],
    transcript,
    events,
  };
}

export {
  extractUserRequest,
  extractModelSelection,
  readTranscriptEntries,
  fileUriToPath,
};
