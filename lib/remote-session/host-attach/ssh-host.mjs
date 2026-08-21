import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { RemoteSessionError } from "../domain/errors.mjs";
import { HOST_CAPABILITIES } from "./contract.mjs";

export function sortAntigravityModels(models = []) {
  const filtered = models.filter((m) => {
    const name = (m.name || m.label || m.id || "").toLowerCase();
    if (name.includes("medium") || name.includes("low")) {
      const hasHigh = models.some((other) => {
        const otherName = (other.name || other.label || other.id || "").toLowerCase();
        if (!otherName.includes("high")) return false;
        if (name.includes("3.7") && otherName.includes("3.7")) return true;
        if (name.includes("3.6") && otherName.includes("3.6")) return true;
        if (name.includes("3.5") && otherName.includes("3.5")) return true;
        if (name.includes("3.1") && otherName.includes("3.1")) return true;
        return false;
      });
      if (hasHigh) return false;
    }
    return true;
  });

  function getScore(m) {
    const name = (m.name || m.label || m.id || "").toLowerCase();
    if (name.includes("gemini")) {
      let v = 1000;
      if (name.includes("3.7")) v += 400;
      else if (name.includes("3.6")) v += 300;
      else if (name.includes("3.5")) v += 200;
      else if (name.includes("3.1")) v += 100;
      
      if (name.includes("high")) v += 30;
      else if (name.includes("medium")) v += 20;
      else if (name.includes("low")) v += 10;
      return v;
    }
    if (name.includes("claude")) {
      let v = 500;
      if (name.includes("sonnet")) v += 50;
      else if (name.includes("opus")) v += 40;
      else if (name.includes("haiku")) v += 30;
      return v;
    }
    if (name.includes("gpt")) {
      return 200;
    }
    return 100;
  }
  return [...filtered].sort((a, b) => getScore(b) - getScore(a));
}

export const OFFICIAL_ANTIGRAVITY_MODELS = sortAntigravityModels([
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash High (Fast)", isRecommended: true },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash High (Fast)" },
  { id: "gemini-3.5-flash-high", name: "Gemini 3.5 Flash High (Fast)" },
  { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro High" },
  { id: "claude-sonnet-4-6-thinking", name: "Claude Sonnet 4.6 (Thinking)" },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  { id: "gpt-oss-120b-high", name: "GPT-OSS 120B (High)" },
]);

function isAbsoluteWorkspacePath(value = "") {
  const raw = String(value || "").trim();
  return /^file:/i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw) || /^[\\/]{2}[^\\/]/.test(raw) || raw.startsWith("/");
}

function toWorkspaceFileUri(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^file:/i.test(raw)) {
    try {
      return new URL(raw.replace(/\\/g, "/")).href;
    } catch {
      return "";
    }
  }
  const normalized = raw.replace(/\\/g, "/");
  const encodePath = (pathname) => pathname
    .split("/")
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
  if (normalized.startsWith("//")) {
    const withoutPrefix = normalized.slice(2);
    const slash = withoutPrefix.indexOf("/");
    const authority = slash >= 0 ? withoutPrefix.slice(0, slash) : withoutPrefix;
    const pathname = slash >= 0 ? withoutPrefix.slice(slash) : "/";
    return authority ? `file://${authority}${encodePath(pathname)}` : "";
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodePath(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodePath(normalized)}`;
  }
  return "";
}

export function createSshHostBackend({
  peer,
  logger = console,
  runRemoteNodeScriptImpl = null,
} = {}) {
  const id = peer?.id || "ssh-host";
  const host = peer?.transport?.host || "127.0.0.1";
  const port = peer?.transport?.port || 22;
  const user = peer?.auth?.ssh?.username || "root";
  const password = peer?.auth?.ssh?.password || "";
  const keyPath = peer?.auth?.ssh?.privateKeyPath;

  async function runSshNodeScript(script, { timeoutMs = 25000 } = {}) {
    let askpassFile = null;
    const env = { ...process.env, DISPLAY: "dummy:0" };

    if (password) {
      const isWin = process.platform === "win32";
      const ext = isWin ? ".bat" : ".sh";
      askpassFile = path.resolve(os.tmpdir(), `shrimp_ap_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
      if (isWin) {
        fs.writeFileSync(askpassFile, `@echo ${password}\r\n`, "utf8");
      } else {
        fs.writeFileSync(askpassFile, `#!/bin/sh\necho "${password}"\n`, { mode: 0o755 });
      }
      env.SSH_ASKPASS_REQUIRE = "force";
      env.SSH_ASKPASS = askpassFile;
    }

    const args = [
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=6",
      "-p", String(port),
    ];

    if (keyPath) {
      args.push("-i", keyPath);
    }

    const target = user ? `${user}@${host}` : host;
    args.push(target, "node");

    return new Promise((resolve, reject) => {
      const child = spawn("ssh", args, { env, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let timer = null;

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill();
          reject(new RemoteSessionError(
            "host_backend_unavailable",
            `SSH execution timed out after ${timeoutMs}ms on ${target}`,
            { peerId: id },
          ));
        }, timeoutMs);
      }

      child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });

      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        if (askpassFile) { try { fs.unlinkSync(askpassFile); } catch {} }
        reject(new RemoteSessionError(
          "host_backend_unavailable",
          `SSH spawn error: ${err.message}`,
          { peerId: id },
        ));
      });

      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (askpassFile) { try { fs.unlinkSync(askpassFile); } catch {} }
        if (code !== 0 && !stdout.trim()) {
          reject(new RemoteSessionError(
            "host_backend_unavailable",
            `SSH command failed with code ${code}: ${stderr || "unknown error"}`,
            { peerId: id, stderr },
          ));
        } else {
          resolve(stdout);
        }
      });

      child.stdin.write(script);
      child.stdin.end();
    });
  }

  const runRemoteNodeScript = runRemoteNodeScriptImpl || runSshNodeScript;

  return {
    id,
    capabilities() {
      return [...HOST_CAPABILITIES, "getConversation", "inspectConversation"];
    },
    async isRunning() {
      try {
        const out = await runRemoteNodeScript("console.log('ok')", { timeoutMs: 5000 });
        return out.includes("ok");
      } catch {
        return false;
      }
    },
    async attach() {
      return { status: "attached", type: "ssh-host", peerId: id };
    },
    async listProjects() {
      const script = [
        'const fs = require("fs");',
        'const path = require("path");',
        'const os = require("os");',
        'const { execFileSync } = require("child_process");',
        'let DatabaseSync = null;',
        'if (process.env.SHRIMP_REMOTE_SESSION_DISABLE_NODE_SQLITE !== "1") {',
        '  try { ({ DatabaseSync } = require("node:sqlite")); } catch {}',
        '}',
        'const home = os.homedir();',
        'const base = path.join(home, ".gemini", "antigravity");',
        'const brainDir = path.join(base, "brain");',
        'const conversationsDir = path.join(base, "conversations");',
        'const projectsMap = new Map();',
        'let legacyWorkspaceMetadata = null;',
        '// trajectory metadata schema: top-level repeated workspaceUris field.',
        'const METADATA_WORKSPACE_URIS_FIELD_NUMBER = 7;',
        'function cleanTitle(raw) {',
        '  if (!raw) return "";',
        '  let t = String(raw).replace(/<[^>]+>/g, "").replace(/[\\r\\n\\t\\s]+/g, " ").trim();',
        '  if (t.length > 50) t = t.slice(0, 47) + "...";',
        '  return t;',
        '}',
        'function scanDir(dir, depth = 0, maxDepth = 3) {',
        '  if (depth > maxDepth) return;',
        '  try {',
        '    const files = fs.readdirSync(dir);',
        '    const hasGit = files.includes(".git");',
        '    const hasPkg = files.includes("package.json") || files.includes("pom.xml") || files.includes("go.mod") || files.includes("Cargo.toml");',
        '    if (hasGit || hasPkg) {',
        '      projectsMap.set(dir, {',
        '        id: dir,',
        '        name: path.basename(dir),',
        '        path: dir,',
        '        rel: path.relative(home, dir),',
        '        conversations: []',
        '      });',
        '      return;',
        '    }',
        '    for (const f of files) {',
        '      if (f.startsWith(".") || f === "node_modules" || f === "target" || f === "dist" || f === "build" || f === "Library") continue;',
        '      const full = path.join(dir, f);',
        '      try {',
        '        if (fs.statSync(full).isDirectory()) {',
        '          scanDir(full, depth + 1, maxDepth);',
        '        }',
        '      } catch {}',
        '    }',
        '  } catch {}',
        '}',
        'function fileUriToPath(fileUri) {',
        '  const raw = String(fileUri || "").trim();',
        '  if (!raw) return "";',
        '  try {',
        '    if (/^file:/i.test(raw)) {',
        '      const u = new URL(raw.replace(/\\\\/g, "/"));',
        '      let p = decodeURIComponent(u.pathname || "");',
        '      if (u.hostname && u.hostname.toLowerCase() !== "localhost") {',
        '        return "//" + u.hostname + p;',
        '      }',
        '      if (/^[\\\\\\/][A-Za-z]:/.test(p)) p = p.slice(1);',
        '      return p;',
        '    }',
        '  } catch {}',
        '  return raw;',
        '}',
        'function extractProjectPaths(project) {',
        '  const resources = project?.projectResources?.resources;',
        '  if (!Array.isArray(resources)) return [];',
        '  const paths = [];',
        '  for (const resource of resources) {',
        '    const uri = resource?.gitFolder?.folderUri || resource?.folder?.folderUri || resource?.folderUri || "";',
        '    const p = fileUriToPath(uri);',
        '    if (p) paths.push(p);',
        '  }',
        '  return [...new Set(paths)];',
        '}',
        'function normalizeWorkspacePath(value) {',
        '  const converted = fileUriToPath(value);',
        '  if (!converted) return "";',
        '  const isUnc = /^[\\\\/]{2}[^\\\\/]/.test(converted);',
        '  const slashPath = converted.replace(/\\\\/g, "/");',
        '  let normalized = "";',
        '  if (isUnc) {',
        '    const withoutPrefix = slashPath.replace(/^\\/+/, "");',
        '    const slash = withoutPrefix.indexOf("/");',
        '    const authority = slash >= 0 ? withoutPrefix.slice(0, slash) : withoutPrefix;',
        '    const pathname = slash >= 0 ? withoutPrefix.slice(slash) : "/";',
        '    normalized = "//" + authority + path.posix.normalize("/" + pathname.replace(/^\\/+/, ""));',
        '  } else if (/^[A-Za-z]:/.test(slashPath)) {',
        '    normalized = path.win32.normalize(slashPath).replace(/\\\\/g, "/");',
        '  } else {',
        '    normalized = path.posix.normalize(slashPath);',
        '  }',
        '  if (normalized.length > 1) normalized = normalized.replace(/\\/+$/, "");',
        '  if (process.platform === "win32" || /^[A-Za-z]:/.test(normalized) || isUnc) normalized = normalized.toLowerCase();',
        '  return normalized;',
        '}',
        'function readVarint(buffer, offset) {',
        '  let value = 0;',
        '  let shift = 0;',
        '  let cursor = offset;',
        '  while (cursor < buffer.length && shift <= 49) {',
        '    const byte = buffer[cursor++];',
        '    value += (byte & 127) * (2 ** shift);',
        '    if ((byte & 128) === 0) return { value, offset: cursor };',
        '    shift += 7;',
        '  }',
        '  return null;',
        '}',
        'function extractMetadataFileUris(value) {',
        '  const buffer = Buffer.isBuffer(value) || value instanceof Uint8Array',
        '    ? Buffer.from(value)',
        '    : Buffer.from(String(value || ""), "utf8");',
        '  const uris = [];',
        '  let offset = 0;',
        '  while (offset < buffer.length) {',
        '    const key = readVarint(buffer, offset);',
        '    if (!key || key.value === 0) return { valid: false, uris: [] };',
        '    offset = key.offset;',
        '    const fieldNumber = Math.floor(key.value / 8);',
        '    const wireType = key.value & 7;',
        '    if (fieldNumber === 0 || fieldNumber > 0x1fffffff) return { valid: false, uris: [] };',
        '    if (wireType === 0) {',
        '      const item = readVarint(buffer, offset);',
        '      if (!item) return { valid: false, uris: [] };',
        '      offset = item.offset;',
        '    } else if (wireType === 1) {',
        '      if (offset + 8 > buffer.length) return { valid: false, uris: [] };',
        '      offset += 8;',
        '    } else if (wireType === 2) {',
        '      const length = readVarint(buffer, offset);',
        '      if (!length || !Number.isSafeInteger(length.value) || length.value < 0) return { valid: false, uris: [] };',
        '      offset = length.offset;',
        '      const end = offset + length.value;',
        '      if (!Number.isSafeInteger(end) || end > buffer.length) return { valid: false, uris: [] };',
        '      const item = buffer.subarray(offset, end);',
        '      offset = end;',
        '      if (fieldNumber === METADATA_WORKSPACE_URIS_FIELD_NUMBER) {',
        '        const text = item.toString("utf8");',
        '        if (text.includes("\\uFFFD") || !/^file:\\/\\//i.test(text)) return { valid: false, uris: [] };',
        '        uris.push(text);',
        '      }',
        '    } else if (wireType === 5) {',
        '      if (offset + 4 > buffer.length) return { valid: false, uris: [] };',
        '      offset += 4;',
        '    } else {',
        '      return { valid: false, uris: [] };',
        '    }',
        '  }',
        '  return { valid: true, uris: [...new Set(uris)] };',
        '}',
        'function loadLegacyWorkspaceMetadata() {',
        '  if (legacyWorkspaceMetadata) return legacyWorkspaceMetadata;',
        '  const records = new Map();',
        '  legacyWorkspaceMetadata = { status: "unavailable", records };',
        '  if (DatabaseSync) return legacyWorkspaceMetadata;',
        '  if (!fs.existsSync(conversationsDir)) {',
        '    legacyWorkspaceMetadata.status = "ok";',
        '    return legacyWorkspaceMetadata;',
        '  }',
        '  if (process.env.SHRIMP_REMOTE_SESSION_DISABLE_PYTHON_SQLITE === "1") return legacyWorkspaceMetadata;',
        '  const python = [',
        '    "import json, os, pathlib, sqlite3, sys",',
        '    "root = sys.argv[1]",',
        '    "out = {}",',
        '    "for name in os.listdir(root):",',
        '    "    if not name.lower().endswith(\u0027.db\u0027): continue",',
        '    "    db = None",',
        '    "    try:",',
        '    "        db_uri = pathlib.Path(root, name).resolve().as_uri() + \u0027?mode=ro\u0027",',
        '    "        db = sqlite3.connect(db_uri, uri=True)",',
        '    "        row = db.execute(\u0027SELECT data FROM trajectory_metadata_blob WHERE id = \\\"main\\\" LIMIT 1\u0027).fetchone()",',
        '    "        if row and row[0] is not None:",',
        '    "            value = row[0]",',
        '    "            if not isinstance(value, bytes): value = str(value).encode(\u0027utf-8\u0027)",',
        '    "            out[os.path.splitext(name)[0]] = {\u0027status\u0027: \u0027ok\u0027, \u0027data\u0027: value.hex()}",',
        '    "        else:",',
        '    "            out[os.path.splitext(name)[0]] = {\u0027status\u0027: \u0027missing\u0027}",',
        '    "    except Exception:",',
        '    "        out[os.path.splitext(name)[0]] = {\u0027status\u0027: \u0027error\u0027}",',
        '    "    finally:",',
        '    "        if db is not None: db.close()",',
        '    "print(json.dumps(out))",',
        '  ].join("\\n");',
        '  const executables = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];',
        '  for (const executable of executables) {',
        '    try {',
        '      const args = executable === "py" ? ["-3", "-c", python, conversationsDir] : ["-c", python, conversationsDir];',
        '      const raw = execFileSync(executable, args, { encoding: "utf8", timeout: 10000, windowsHide: true });',
        '      const parsed = JSON.parse(raw || "{}");',
        '      for (const [conversationId, value] of Object.entries(parsed)) {',
        '        records.set(conversationId, value);',
        '      }',
        '      legacyWorkspaceMetadata.status = "ok";',
        '      break;',
        '    } catch {}',
        '  }',
        '  return legacyWorkspaceMetadata;',
        '}',
        'function readConversationWorkspaceMetadata(conversationId) {',
        '  const dbPath = path.join(conversationsDir, conversationId + ".db");',
        '  let db = null;',
        '  try {',
        '    if (!fs.existsSync(dbPath)) return { status: "missing", paths: [] };',
        '    let blob = null;',
        '    if (DatabaseSync) {',
        '      db = new DatabaseSync(dbPath, { readOnly: true });',
        '      blob = db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = \u0027main\u0027 LIMIT 1").get()?.data;',
        '      if (blob == null) return { status: "missing", paths: [] };',
        '    } else {',
        '      const legacy = loadLegacyWorkspaceMetadata();',
        '      if (legacy.status !== "ok") return { status: "error", paths: [] };',
        '      const metadata = legacy.records.get(conversationId);',
        '      if (!metadata) return { status: "missing", paths: [] };',
        '      if (metadata.status === "error") return { status: "error", paths: [] };',
        '      if (metadata.status !== "ok") return { status: "missing", paths: [] };',
        '      const hex = String(metadata.data || "");',
        '      if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return { status: "error", paths: [] };',
        '      blob = Buffer.from(hex, "hex");',
        '    }',
        '    const extracted = extractMetadataFileUris(blob);',
        '    if (!extracted.valid) return { status: "error", paths: [] };',
        '    const paths = [...new Set(extracted.uris.map(normalizeWorkspacePath).filter(Boolean))];',
        '    return { status: paths.length > 0 ? "ok" : "missing", paths };',
        '  } catch {} finally {',
        '    try { db?.close?.(); } catch {}',
        '  }',
        '  return { status: "error", paths: [] };',
        '}',
        'function isWorkspacePathContained(rootPath, candidatePath) {',
        '  const root = normalizeWorkspacePath(rootPath);',
        '  const candidate = normalizeWorkspacePath(candidatePath);',
        '  return Boolean(root && candidate && (candidate === root || candidate.startsWith(root + "/")));',
        '}',
        'function stripNonFileUris(content) {',
        '  return String(content || "").replace(/\\b(?!file:)[A-Za-z][A-Za-z0-9+.-]*:\\/\\/[^\\s"\u0027`<>]+/gi, " ");',
        '}',
        'function extractPathsFromKnownWorkspaceRoot(content, projectPath) {',
        '  const target = normalizeWorkspacePath(projectPath);',
        '  if (!target) return [];',
        '  const text = stripNonFileUris(content).replace(/\\\\/g, "/");',
        '  const caseInsensitive = process.platform === "win32" || /^[A-Za-z]:/.test(target) || target.startsWith("//");',
        '  const comparableText = caseInsensitive ? text.toLowerCase() : text;',
        '  const comparableTarget = caseInsensitive ? target.toLowerCase() : target;',
        '  const candidates = [];',
        '  let offset = 0;',
        '  while (true) {',
        '    const index = comparableText.indexOf(comparableTarget, offset);',
        '    if (index < 0) break;',
        '    const before = index > 0 ? comparableText[index - 1] : "";',
        '    const after = comparableText[index + comparableTarget.length] || "";',
        '    const fileUriPrefix = text.slice(Math.max(0, index - 8), index).toLowerCase();',
        '    const beforeOk = !before || /[\\s"\u0027`([{=:]/.test(before) || fileUriPrefix.endsWith("file://");',
        '    const afterOk = !after || after === "/" || /[\\s"\u0027`),\\]}:;.!?，。；！？]/u.test(after);',
        '    if (beforeOk && afterOk) {',
        '      let end = index + comparableTarget.length;',
        '      if (after === "/") {',
        '        while (end < text.length && !/["\u0027`<>\\r\\n),\\]};:;!?，。；！？]/u.test(text[end])) end += 1;',
        '      }',
        '      const raw = text.slice(index, end).trimEnd();',
        '      const normalized = normalizeWorkspacePath(raw);',
        '      if (normalized) candidates.push(normalized);',
        '    }',
        '    offset = index + comparableTarget.length;',
        '  }',
        '  return [...new Set(candidates)];',
        '}',
        'function extractTranscriptWorkspacePaths(content, projectPaths = []) {',
        '  const text = stripNonFileUris(content);',
        '  const candidates = [];',
        '  const patterns = [',
        '    /file:\\/\\/[^\\s"\u0027`<>]+/gi,',
        '    /[A-Za-z]:[\\\\/][^\\s"\u0027`<>]+/g,',
        '    /\\\\\\\\[^\\\\/\\s"\u0027`<>]+[\\\\/][^\\s"\u0027`<>]+/g,',
        '    /\\/[^\\s"\u0027`<>]+/g,',
        '  ];',
        '  for (const pattern of patterns) {',
        '    for (const match of text.matchAll(pattern)) {',
        '      const raw = String(match[0] || "").replace(/[),\\]}>;.!?，。；！？]+$/u, "");',
        '      const normalized = normalizeWorkspacePath(raw);',
        '      if (normalized) candidates.push(normalized);',
        '    }',
        '  }',
        '  for (const projectPath of projectPaths) {',
        '    candidates.push(...extractPathsFromKnownWorkspaceRoot(text, projectPath));',
        '  }',
        '  return [...new Set(candidates)];',
        '}',
        'const geminiProjDir = path.join(home, ".gemini", "config", "projects");',
        'if (fs.existsSync(geminiProjDir)) {',
        '  try {',
        '    const files = fs.readdirSync(geminiProjDir);',
        '    for (const f of files) {',
        '      if (!f.toLowerCase().endsWith(".json") || f.toLowerCase() === "outside-of-project.json") continue;',
        '      try {',
        '        const full = path.join(geminiProjDir, f);',
        '        const parsed = JSON.parse(fs.readFileSync(full, "utf8"));',
        '        const id = String(parsed.id || path.basename(f, ".json"));',
        '        const projectPaths = extractProjectPaths(parsed);',
        '        const pPath = projectPaths[0] || "";',
        '        projectsMap.set(id, {',
        '          id,',
        '          name: String(parsed.name || id),',
        '          path: pPath,',
        '          paths: projectPaths,',
        '          rel: path.relative(home, pPath),',
        '          source: "antigravity-project-store",',
        '          conversations: []',
        '        });',
        '      } catch {}',
        '    }',
        '  } catch {}',
        '}',
        'if (projectsMap.size === 0) {',
        '  const candidateRoots = [',
        '    path.join(home, "project"),',
        '    path.join(home, "Projects"),',
        '    path.join(home, "Desktop"),',
        '    "D:\\\\",',
        '    "D:\\\\project",',
        '  ].filter((p) => { try { return fs.existsSync(p); } catch { return false; } });',
        '  for (const cRoot of candidateRoots) {',
        '    scanDir(cRoot, 0, 2);',
        '  }',
        '  scanDir(home, 0, 1);',
        '}',
        'if (fs.existsSync(brainDir)) {',
        '  try {',
        '    const folders = fs.readdirSync(brainDir);',
        '    for (const folder of folders) {',
        '      const logPath = path.join(brainDir, folder, ".system_generated", "logs", "transcript.jsonl");',
        '      if (fs.existsSync(logPath)) {',
        '        try {',
        '          const content = fs.readFileSync(logPath, "utf8");',
        '          const lines = content.split(String.fromCharCode(10));',
        '          const transcriptContents = lines.map((line) => {',
        '            try {',
        '              const parsed = JSON.parse(line);',
        '              return typeof parsed?.content === "string" ? parsed.content : "";',
        '            } catch { return ""; }',
        '          });',
        '          const knownProjectPaths = Array.from(projectsMap.values())',
        '            .flatMap((project) => project.paths || [project.path])',
        '            .map(normalizeWorkspacePath)',
        '            .filter(Boolean);',
        '          const transcriptPaths = [...new Set(transcriptContents',
        '            .flatMap((text) => extractTranscriptWorkspacePaths(text, knownProjectPaths)))];',
        '          let title = "";',
        '          let updatedAt = 0;',
        '          try { updatedAt = fs.statSync(logPath).mtimeMs; } catch {}',
        '          let matchedProjId = "";',
        '          const workspaceMetadata = readConversationWorkspaceMetadata(folder);',
        '          if (workspaceMetadata.status === "ok") {',
        '            const metadataMatches = Array.from(projectsMap.entries())',
        '              .filter(([, pObj]) => {',
        '                const projectPaths = (pObj.paths || [pObj.path]).map(normalizeWorkspacePath).filter(Boolean);',
        '                return projectPaths.some((projectPath) => workspaceMetadata.paths.includes(projectPath));',
        '              });',
        '            if (metadataMatches.length === 1) matchedProjId = metadataMatches[0][0];',
        '          } else if (workspaceMetadata.status === "missing") {',
        '            const pathMatches = Array.from(projectsMap.entries()).map(([projectId, pObj]) => {',
        '              const matchedPaths = (pObj.paths || [pObj.path])',
        '                .map(normalizeWorkspacePath)',
        '                .filter((projectPath) => projectPath && transcriptPaths.some((candidatePath) => isWorkspacePathContained(projectPath, candidatePath)));',
        '              return { projectId, matchedPaths: [...new Set(matchedPaths)] };',
        '            }).filter((match) => match.matchedPaths.length > 0);',
        '            if (pathMatches.length === 1) {',
        '              matchedProjId = pathMatches[0].projectId;',
        '            } else if (pathMatches.length > 1) {',
        '              const matchedRoots = [...new Set(pathMatches.flatMap((match) => match.matchedPaths))]',
        '                .sort((a, b) => a.length - b.length);',
        '              const isSingleAncestorChain = matchedRoots.every((root, index) =>',
        '                index === 0 || isWorkspacePathContained(matchedRoots[index - 1], root));',
        '              if (isSingleAncestorChain) {',
        '                const deepestRoot = matchedRoots[matchedRoots.length - 1];',
        '                const deepestMatches = pathMatches.filter((match) => match.matchedPaths.includes(deepestRoot));',
        '                if (deepestMatches.length === 1) matchedProjId = deepestMatches[0].projectId;',
        '              }',
        '            }',
        '          }',
        '          for (const line of lines) {',
        '            if (!line.trim()) continue;',
        '            let parsed = null;',
        '            try { parsed = JSON.parse(line); } catch {}',
        '            const cText = parsed?.content || line;',
        '            if (!title && cText.includes("<USER_REQUEST>")) {',
        '              const idx = cText.indexOf("<USER_REQUEST>");',
        '              const sub = cText.slice(idx + 14);',
        '              const endIdx = sub.indexOf("</USER_REQUEST>");',
        '              const rawReq = endIdx >= 0 ? sub.slice(0, endIdx) : sub.slice(0, 100);',
        '              title = cleanTitle(rawReq);',
        '            }',
        '          }',
        '          const convItem = {',
        '            id: folder,',
        '            title: title || ("会话 " + folder.slice(0, 8)),',
        '            updatedAt: updatedAt || Date.now()',
        '          };',
        '          if (matchedProjId && projectsMap.has(matchedProjId)) {',
        '            projectsMap.get(matchedProjId).conversations.push(convItem);',
        '          }',
        '        } catch {}',
        '      }',
        '    }',
        '  } catch {}',
        '}',
        'const list = Array.from(projectsMap.values());',
        'for (const p of list) {',
        '  p.conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));',
        '}',
        'list.sort((a, b) => {',
        '  const aTime = a.conversations[0]?.updatedAt || 0;',
        '  const bTime = b.conversations[0]?.updatedAt || 0;',
        '  if (aTime !== bTime) return bTime - aTime;',
        '  const aLen = a.conversations.length;',
        '  const bLen = b.conversations.length;',
        '  if (aLen !== bLen) return bLen - aLen;',
        '  return a.name.localeCompare(b.name);',
        '});',
        'console.log(JSON.stringify(list));',
      ].join("\n");

      try {
        const raw = await runRemoteNodeScript(script, { timeoutMs: 15000 });
        const jsonMatch = raw.trim().match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        return [];
      } catch (err) {
        logger?.warn?.(`[ssh-host] listProjects failed for ${id}: ${err.message}`);
        return [];
      }
    },
    async listConversations({ limit = 20 } = {}) {
      const projects = await this.listProjects();
      const allConvs = [];
      for (const p of projects) {
        for (const c of p.conversations || []) {
          allConvs.push({
            ...c,
            projectId: p.id,
            projectPath: p.path,
            status: "ready"
          });
        }
      }
      allConvs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return allConvs.slice(0, limit);
    },
    async getConversation(conversationId) {
      if (!conversationId) return null;
      const script = [
        'const fs = require("fs");',
        'const path = require("path");',
        'const os = require("os");',
        'const https = require("https");',
        'const { execSync } = require("child_process");',
        'const home = os.homedir();',
        'const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");',
        'function findAntigravityServer() {',
        '  const candidateLogs = [',
        '    path.join(roaming, "Antigravity", "logs", "main.log"),',
        '    path.join(roaming, "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "main.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, ".config", "Antigravity", "logs", "main.log"),',
        '    path.join(home, ".gemini", "antigravity", "logs", "main.log"),',
        '  ];',
        '  for (const logPath of candidateLogs) {',
        '    if (fs.existsSync(logPath)) {',
        '      try {',
        '        const text = fs.readFileSync(logPath, "utf8");',
        '        const localMatches = [...text.matchAll(/Local:\\s+(https:\\/\\/127\\.0\\.0\\.1:(\\d+)\\/?)/g)];',
        '        const csrfMatches = [...text.matchAll(/--csrf_token\\s+([A-Za-z0-9_-]+)/gi)];',
        '        if (localMatches.length > 0 && csrfMatches.length > 0) {',
        '          const port = Number(localMatches[localMatches.length - 1][2]);',
        '          const csrf = csrfMatches[csrfMatches.length - 1][1];',
        '          if (port && csrf) return { port, csrf };',
        '        }',
        '      } catch {}',
        '    }',
        '  }',
        '  if (process.platform === "win32") {',
        '    try {',
        '      const cmdOut = execSync(\'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like \'%language_server%\'\\" | Select-Object -ExpandProperty CommandLine"\', { timeout: 3000 }).toString("utf8");',
        '      const mCsrf = cmdOut.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mCsrf) {',
        '        const netOut = execSync(\'netstat -ano | findstr "127.0.0.1:" | findstr "LISTENING"\', { timeout: 3000 }).toString("utf8");',
        '        const portMatches = [...netOut.matchAll(/127\\.0\\.0\\.1:(\\d+)/g)];',
        '        for (const pm of portMatches) {',
        '          const p = Number(pm[1]);',
        '          if (p > 1024 && p !== 8787 && p !== 8788 && p !== 7000 && p !== 7500) {',
        '            return { port: p, csrf: mCsrf[1] };',
        '          }',
        '        }',
        '      }',
        '    } catch {}',
        '  } else {',
        '    try {',
        '      const ps = execSync("ps aux | grep -i language_server | grep -v grep", { timeout: 3000 }).toString("utf8");',
        '      const mPid = ps.match(/\\S+\\s+(\\d+)/);',
        '      const mCsrf = ps.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mPid && mCsrf) {',
        '        const lsof = execSync("lsof -Pan -p " + mPid[1] + " -i", { timeout: 3000 }).toString("utf8");',
        '        const mPort = lsof.match(/127\\.0\\.0\\.1:(\\d+)\\s+\\(LISTEN\\)/);',
        '        if (mPort) return { port: Number(mPort[1]), csrf: mCsrf[1] };',
        '      }',
        '    } catch {}',
        '  }',
        '  return null;',
        '}',
        `const convId = "${conversationId}";`,
        'const logPath = path.join(home, ".gemini", "antigravity", "brain", convId, ".system_generated", "logs", "transcript.jsonl");',
        'function cleanUserContent(content) {',
        '  let str = String(content || "");',
        '  const match = str.match(/<USER_REQUEST>([\\s\\S]*?)<\\/USER_REQUEST>/i);',
        '  if (match && match[1]) str = match[1];',
        '  str = str.replace(/<(environment_context|model_switch|system_reminder|system)[^>]*>[\\s\\S]*?<\\/\\1>/gi, "");',
        '  str = str.replace(/<ADDITIONAL_METADATA>[\\s\\S]*?<\\/ADDITIONAL_METADATA>/gi, "");',
        '  str = str.replace(/<USER_SETTINGS_CHANGE>[\\s\\S]*?<\\/USER_SETTINGS_CHANGE>/gi, "");',
        '  return str.trim();',
        '}',
        'const messages = [];',
        'const events = [];',
        'let pendingTools = [];',
        'let title = "";',
        'if (fs.existsSync(logPath)) {',
        '  const content = fs.readFileSync(logPath, "utf8");',
        '  const lines = content.split(String.fromCharCode(10));',
        '  for (const line of lines) {',
        '    if (!line.trim()) continue;',
        '    let obj = null;',
        '    try { obj = JSON.parse(line); } catch {}',
        '    if (!obj) continue;',
        '    const type = obj.type || "";',
        '    const time = obj.created_at || obj.timestamp || "";',
        '    if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {',
        '      for (const tc of obj.tool_calls) {',
        '        const name = tc.name || tc.tool || "tool";',
        '        const summary = tc.args?.toolSummary || tc.args?.toolAction || tc.args?.summary || tc.toolSummary || "";',
        '        const detail = tc.args?.CommandLine || tc.args?.TargetFile || tc.args?.AbsolutePath || (tc.args ? JSON.stringify(tc.args) : "");',
        '        pendingTools.push({',
        '          name,',
        '          summary: String(summary || "").replace(/^"|"$/g, ""),',
        '          detail: String(detail || "").replace(/^"|"$/g, "").slice(0, 500)',
        '        });',
        '      }',
        '    }',
        '    if (type === "USER_INPUT" && obj.content) {',
        '      const uText = cleanUserContent(obj.content);',
        '      if (uText) {',
        '        if (!title) title = uText.slice(0, 50);',
        '        messages.push({',
        '          id: "step-" + (obj.step_index ?? messages.length),',
        '          role: "user",',
        '          content: uText,',
        '          timestamp: time',
        '        });',
        '        events.push({ type: "user_message", text: uText, seq: events.length + 1 });',
        '      }',
        '    } else if (type === "PLANNER_RESPONSE" || (obj.source === "MODEL" && type !== "GENERIC")) {',
        '      let aText = String(obj.content || "").replace(/<think>[\\s\\S]*?<\\/think>/g, "").trim();',
        '      const tools = pendingTools;',
        '      pendingTools = [];',
        '      const last = messages[messages.length - 1];',
        '      if (last && last.role === "assistant" && (!last.content || !aText)) {',
        '        if (aText) last.content = (last.content ? last.content + "\\n\\n" : "") + aText;',
        '        if (tools.length > 0) last.tools = [...(last.tools || []), ...tools];',
        '      } else if (aText || tools.length > 0) {',
        '        messages.push({',
        '          id: "step-" + (obj.step_index ?? messages.length),',
        '          role: "assistant",',
        '          content: aText,',
        '          timestamp: time,',
        '          tools: tools.length > 0 ? tools : undefined',
        '        });',
        '        events.push({ type: "assistant_text", text: aText, seq: events.length + 1 });',
        '      }',
        '    }',
        '  }',
        '  if (pendingTools.length > 0 && messages.length > 0 && messages[messages.length - 1].role === "assistant") {',
        '    messages[messages.length - 1].tools = [...(messages[messages.length - 1].tools || []), ...pendingTools];',
        '  }',
        '}',
        'async function checkLiveTrajectory() {',
        '  if (messages.length > 0) return;',
        '  try {',
        '    const srv = findAntigravityServer();',
        '    if (!srv) return;',
        '    const { port, csrf } = srv;',
        '    const agent = new https.Agent({ rejectUnauthorized: false });',
        '    const postData = JSON.stringify({ cascadeId: convId });',
        '    const resData = await new Promise((resolve) => {',
        '      const req = https.request({',
        '        hostname: "127.0.0.1",',
        '        port,',
        '        path: "/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory",',
        '        method: "POST",',
        '        headers: {',
        '          "Content-Type": "application/json",',
        '          "X-Codeium-Csrf-Token": csrf,',
        '          "Connect-Protocol-Version": "1",',
        '          "Content-Length": Buffer.byteLength(postData)',
        '        },',
        '        agent,',
        '        timeout: 5000',
        '      }, (res) => {',
        '        let buf = "";',
        '        res.on("data", c => buf += c);',
        '        res.on("end", () => resolve(buf));',
        '      });',
        '      req.on("error", () => resolve(""));',
        '      req.write(postData);',
        '      req.end();',
        '    });',
        '    if (resData) {',
        '      const parsed = JSON.parse(resData);',
        '      const steps = parsed.steps || parsed.trajectory?.steps || [];',
        '      for (let i = 0; i < steps.length; i++) {',
        '        const st = steps[i];',
        '        const t = st.type || "";',
        '        if (t.includes("USER_INPUT")) {',
        '          const uText = cleanUserContent(st.userInput?.userResponse || st.userInput?.text || st.content || "");',
        '          if (uText) {',
        '            if (!title) title = uText.slice(0, 50);',
        '            messages.push({ id: "step-" + i, role: "user", content: uText, timestamp: st.metadata?.createdAt || "" });',
        '          }',
        '        } else if (t.includes("PLANNER_RESPONSE") || t.includes("ASSISTANT")) {',
        '          const aText = String(st.plannerResponse?.response || st.plannerResponse?.text || st.content || "").replace(/<think>[\\s\\S]*?<\\/think>/g, "").trim();',
        '          if (aText) {',
        '            messages.push({ id: "step-" + i, role: "assistant", content: aText, timestamp: st.metadata?.createdAt || "" });',
        '          }',
        '        }',
        '      }',
        '    }',
        '  } catch {}',
        '}',
        'checkLiveTrajectory().then(() => {',
        '  console.log(JSON.stringify({ conversationId: convId, title, messages, events }));',
        '});',
      ].join("\n");

      try {
        const raw = await runRemoteNodeScript(script, { timeoutMs: 15000 });
        const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        logger?.warn?.(`[ssh-host] getConversation error for ${conversationId}: ${err.message}`);
      }
      return { conversationId, title: "", messages: [], events: [] };
    },
    async getAutoModel() {
      return { model: "gemini-3.7-flash-high", source: "antigravity" };
    },
    async listAvailableModels() {
      const script = [
        'const fs = require("fs");',
        'const path = require("path");',
        'const os = require("os");',
        'const https = require("https");',
        'const { execSync } = require("child_process");',
        'const home = os.homedir();',
        'const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");',
        'function findAntigravityServer() {',
        '  const candidateLogs = [',
        '    path.join(roaming, "Antigravity", "logs", "main.log"),',
        '    path.join(roaming, "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "main.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, ".config", "Antigravity", "logs", "main.log"),',
        '    path.join(home, ".gemini", "antigravity", "logs", "main.log"),',
        '  ];',
        '  for (const logPath of candidateLogs) {',
        '    if (fs.existsSync(logPath)) {',
        '      try {',
        '        const text = fs.readFileSync(logPath, "utf8");',
        '        const localMatches = [...text.matchAll(/Local:\\s+(https:\\/\\/127\\.0\\.0\\.1:(\\d+)\\/?)/g)];',
        '        const csrfMatches = [...text.matchAll(/--csrf_token\\s+([A-Za-z0-9_-]+)/gi)];',
        '        if (localMatches.length > 0 && csrfMatches.length > 0) {',
        '          const port = Number(localMatches[localMatches.length - 1][2]);',
        '          const csrf = csrfMatches[csrfMatches.length - 1][1];',
        '          if (port && csrf) return { port, csrf };',
        '        }',
        '      } catch {}',
        '    }',
        '  }',
        '  if (process.platform === "win32") {',
        '    try {',
        '      const cmdOut = execSync(\'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like \'%language_server%\'\\" | Select-Object -ExpandProperty CommandLine"\', { timeout: 3000 }).toString("utf8");',
        '      const mCsrf = cmdOut.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mCsrf) {',
        '        const netOut = execSync(\'netstat -ano | findstr "127.0.0.1:" | findstr "LISTENING"\', { timeout: 3000 }).toString("utf8");',
        '        const portMatches = [...netOut.matchAll(/127\\.0\\.0\\.1:(\\d+)/g)];',
        '        for (const pm of portMatches) {',
        '          const p = Number(pm[1]);',
        '          if (p > 1024 && p !== 8787 && p !== 8788 && p !== 7000 && p !== 7500) {',
        '            return { port: p, csrf: mCsrf[1] };',
        '          }',
        '        }',
        '      }',
        '    } catch {}',
        '  } else {',
        '    try {',
        '      const ps = execSync("ps aux | grep -i language_server | grep -v grep", { timeout: 3000 }).toString("utf8");',
        '      const mPid = ps.match(/\\S+\\s+(\\d+)/);',
        '      const mCsrf = ps.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mPid && mCsrf) {',
        '        const lsof = execSync("lsof -Pan -p " + mPid[1] + " -i", { timeout: 3000 }).toString("utf8");',
        '        const mPort = lsof.match(/127\\.0\\.0\\.1:(\\d+)\\s+\\(LISTEN\\)/);',
        '        if (mPort) return { port: Number(mPort[1]), csrf: mCsrf[1] };',
        '      }',
        '    } catch {}',
        '  }',
        '  return null;',
        '}',
        'async function fetchLiveModels() {',
        '  try {',
        '    const srv = findAntigravityServer();',
        '    if (srv) {',
        '      const { port, csrf } = srv;',
        '      const agent = new https.Agent({ rejectUnauthorized: false });',
        '      const postData = JSON.stringify({});',
        '      const resData = await new Promise((resolve) => {',
        '        const req = https.request({',
        '          hostname: "127.0.0.1",',
        '          port,',
        '          path: "/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigData",',
        '          method: "POST",',
        '          headers: {',
        '            "Content-Type": "application/json",',
        '            "X-Codeium-Csrf-Token": csrf,',
        '            "Connect-Protocol-Version": "1",',
        '            "Content-Length": Buffer.byteLength(postData)',
        '          },',
        '          agent,',
        '          timeout: 4000',
        '        }, (res) => {',
        '          let buf = "";',
        '          res.on("data", c => buf += c);',
        '          res.on("end", () => resolve(buf));',
        '        });',
        '        req.on("error", () => resolve(""));',
        '        req.write(postData);',
        '        req.end();',
        '      });',
        '      if (resData) {',
        '        const parsed = JSON.parse(resData);',
        '        if (Array.isArray(parsed.clientModelConfigs) && parsed.clientModelConfigs.length > 0) {',
        '          return parsed.clientModelConfigs.map(cfg => {',
        '            const tag = cfg.tagTitle ? (" (" + cfg.tagTitle + ")") : "";',
        '            return {',
        '              id: cfg.modelOrAlias?.model || cfg.modelOrAlias?.alias || cfg.label,',
        '              name: cfg.label + tag,',
        '              rawLabel: cfg.label,',
        '              modelOrAlias: cfg.modelOrAlias,',
        '              isRecommended: Boolean(cfg.isRecommended),',
        '              source: "live-language-server"',
        '            };',
        '          });',
        '        }',
        '      }',
        '    }',
        '  } catch (e) {}',
        '  return [];',
        '}',
        'fetchLiveModels().then(m => console.log(JSON.stringify(m)));',
      ].join("\n");

      try {
        const raw = await runRemoteNodeScript(script, { timeoutMs: 8000 });
        const jsonMatch = raw.trim().match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const live = JSON.parse(jsonMatch[0]);
          if (Array.isArray(live) && live.length > 0) {
            return sortAntigravityModels(live);
          }
        }
      } catch (err) {
        logger?.warn?.(`[ssh-host] dynamic listAvailableModels error for ${id}: ${err.message}`);
      }
      return OFFICIAL_ANTIGRAVITY_MODELS;
    },
    async createConversation(projectId, { conversationId, model, cascadeConfig } = {}) {
      if (conversationId) {
        return {
          conversationId,
          projectId,
          model: model || "gemini-3.7-flash-high",
        };
      }
      const projects = await this.listProjects();
      const storedProject = projects.find((project) => project.id === projectId);
      if (!storedProject) {
        throw new RemoteSessionError(
          "invalid_request",
          `project not found: ${projectId}`,
          { peerId: id, projectId },
        );
      }
      const workspacePath = String(storedProject.path || "").trim();
      const workspaceUri = isAbsoluteWorkspacePath(workspacePath)
        ? toWorkspaceFileUri(workspacePath)
        : "";
      if (!workspaceUri) {
        throw new RemoteSessionError(
          "invalid_request",
          `project has no valid workspace path: ${projectId}`,
          { peerId: id, projectId },
        );
      }
      // Start a real cascade on the remote language server if available
      const script = [
        'const fs = require("fs");',
        'const path = require("path");',
        'const os = require("os");',
        'const https = require("https");',
        'const { execSync } = require("child_process");',
        'const home = os.homedir();',
        'const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");',
        'function findAntigravityServer() {',
        '  const candidateLogs = [',
        '    path.join(roaming, "Antigravity", "logs", "main.log"),',
        '    path.join(roaming, "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "main.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, ".config", "Antigravity", "logs", "main.log"),',
        '    path.join(home, ".gemini", "antigravity", "logs", "main.log"),',
        '  ];',
        '  for (const logPath of candidateLogs) {',
        '    if (fs.existsSync(logPath)) {',
        '      try {',
        '        const text = fs.readFileSync(logPath, "utf8");',
        '        const localMatches = [...text.matchAll(/Local:\\s+(https:\\/\\/127\\.0\\.0\\.1:(\\d+)\\/?)/g)];',
        '        const csrfMatches = [...text.matchAll(/--csrf_token\\s+([A-Za-z0-9_-]+)/gi)];',
        '        if (localMatches.length > 0 && csrfMatches.length > 0) {',
        '          const port = Number(localMatches[localMatches.length - 1][2]);',
        '          const csrf = csrfMatches[csrfMatches.length - 1][1];',
        '          if (port && csrf) return { port, csrf };',
        '        }',
        '      } catch {}',
        '    }',
        '  }',
        '  if (process.platform === "win32") {',
        '    try {',
        '      const cmdOut = execSync(\'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like \'%language_server%\'\\" | Select-Object -ExpandProperty CommandLine"\', { timeout: 3000 }).toString("utf8");',
        '      const mCsrf = cmdOut.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mCsrf) {',
        '        const netOut = execSync(\'netstat -ano | findstr "127.0.0.1:" | findstr "LISTENING"\', { timeout: 3000 }).toString("utf8");',
        '        const portMatches = [...netOut.matchAll(/127\\.0\\.0\\.1:(\\d+)/g)];',
        '        for (const pm of portMatches) {',
        '          const p = Number(pm[1]);',
        '          if (p > 1024 && p !== 8787 && p !== 8788 && p !== 7000 && p !== 7500) {',
        '            return { port: p, csrf: mCsrf[1] };',
        '          }',
        '        }',
        '      }',
        '    } catch {}',
        '  } else {',
        '    try {',
        '      const ps = execSync("ps aux | grep -i language_server | grep -v grep", { timeout: 3000 }).toString("utf8");',
        '      const mPid = ps.match(/\\S+\\s+(\\d+)/);',
        '      const mCsrf = ps.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mPid && mCsrf) {',
        '        const lsof = execSync("lsof -Pan -p " + mPid[1] + " -i", { timeout: 3000 }).toString("utf8");',
        '        const mPort = lsof.match(/127\\.0\\.0\\.1:(\\d+)\\s+\\(LISTEN\\)/);',
        '        if (mPort) return { port: Number(mPort[1]), csrf: mCsrf[1] };',
        '      }',
        '    } catch {}',
        '  }',
        '  return null;',
        '}',
        'async function startCascade() {',
        '  try {',
        '    const srv = findAntigravityServer();',
        '    if (srv) {',
        '      const { port, csrf } = srv;',
        '      const agent = new https.Agent({ rejectUnauthorized: false });',
        `      const postData = JSON.stringify({
          source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
          trajectoryType: "CORTEX_TRAJECTORY_TYPE_CASCADE",
          workspaceUris: [${JSON.stringify(workspaceUri)}]
        });`,
        '      const resData = await new Promise((resolve) => {',
        '        const req = https.request({',
        '          hostname: "127.0.0.1",',
        '          port,',
        '          path: "/exa.language_server_pb.LanguageServerService/StartCascade",',
        '          method: "POST",',
        '          headers: {',
        '            "Content-Type": "application/json",',
        '            "X-Codeium-Csrf-Token": csrf,',
        '            "Connect-Protocol-Version": "1",',
        '            "Content-Length": Buffer.byteLength(postData)',
        '          },',
        '          agent,',
        '          timeout: 5000',
        '        }, (res) => {',
        '          let buf = "";',
        '          res.on("data", c => buf += c);',
        '          res.on("end", () => resolve(buf));',
        '        });',
        '        req.on("error", () => resolve(""));',
        '        req.write(postData);',
        '        req.end();',
        '      });',
        '      if (resData) {',
        '        const parsed = JSON.parse(resData);',
        '        if (parsed.cascadeId) {',
        '          return { conversationId: parsed.cascadeId, trajectoryId: parsed.trajectoryId || "" };',
        '        }',
        '      }',
        '    }',
        '  } catch (e) {}',
        `  return { conversationId: "conv_${Date.now()}" };`,
        '}',
        'startCascade().then(res => console.log(JSON.stringify(res)));',
      ].join("\n");

      try {
        const raw = await runRemoteNodeScript(script, { timeoutMs: 8000 });
        const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const res = JSON.parse(jsonMatch[0]);
          return {
            conversationId: res.conversationId || `conv_${Date.now()}`,
            projectId,
            workspaceUri,
            model: model || "gemini-3.7-flash-high",
          };
        }
      } catch {}

      return {
        conversationId: `conv_${Date.now()}`,
        projectId,
        workspaceUri,
        model: model || "gemini-3.7-flash-high",
      };
    },
    async dispatchPrompt({
      conversationId,
      prompt,
      controllerPeerId,
      model = null,
      modelAlias = "AUTO",
      cascadeConfig = null,
    } = {}) {
      if (!conversationId) {
        throw new RemoteSessionError("invalid_request", "conversationId is required");
      }
      if (!prompt) {
        throw new RemoteSessionError("invalid_request", "prompt is required");
      }

      const requestedModelId = model || "MODEL_PLACEHOLDER_M298";
      const escapedPrompt = JSON.stringify(prompt);

      const script = [
        'const fs = require("fs");',
        'const path = require("path");',
        'const os = require("os");',
        'const https = require("https");',
        'const { execSync } = require("child_process");',
        'const home = os.homedir();',
        'const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");',
        'function findAntigravityServer() {',
        '  const candidateLogs = [',
        '    path.join(roaming, "Antigravity", "logs", "main.log"),',
        '    path.join(roaming, "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "main.log"),',
        '    path.join(home, "Library", "Application Support", "Antigravity", "logs", "language_server.log"),',
        '    path.join(home, ".config", "Antigravity", "logs", "main.log"),',
        '    path.join(home, ".gemini", "antigravity", "logs", "main.log"),',
        '  ];',
        '  for (const logPath of candidateLogs) {',
        '    if (fs.existsSync(logPath)) {',
        '      try {',
        '        const text = fs.readFileSync(logPath, "utf8");',
        '        const localMatches = [...text.matchAll(/Local:\\s+(https:\\/\\/127\\.0\\.0\\.1:(\\d+)\\/?)/g)];',
        '        const csrfMatches = [...text.matchAll(/--csrf_token\\s+([A-Za-z0-9_-]+)/gi)];',
        '        if (localMatches.length > 0 && csrfMatches.length > 0) {',
        '          const port = Number(localMatches[localMatches.length - 1][2]);',
        '          const csrf = csrfMatches[csrfMatches.length - 1][1];',
        '          if (port && csrf) return { port, csrf };',
        '        }',
        '      } catch {}',
        '    }',
        '  }',
        '  if (process.platform === "win32") {',
        '    try {',
        '      const cmdOut = execSync(\'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like \'%language_server%\'\\" | Select-Object -ExpandProperty CommandLine"\', { timeout: 3000 }).toString("utf8");',
        '      const mCsrf = cmdOut.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mCsrf) {',
        '        const netOut = execSync(\'netstat -ano | findstr "127.0.0.1:" | findstr "LISTENING"\', { timeout: 3000 }).toString("utf8");',
        '        const portMatches = [...netOut.matchAll(/127\\.0\\.0\\.1:(\\d+)/g)];',
        '        for (const pm of portMatches) {',
        '          const p = Number(pm[1]);',
        '          if (p > 1024 && p !== 8787 && p !== 8788 && p !== 7000 && p !== 7500) {',
        '            return { port: p, csrf: mCsrf[1] };',
        '          }',
        '        }',
        '      }',
        '    } catch {}',
        '  } else {',
        '    try {',
        '      const ps = execSync("ps aux | grep -i language_server | grep -v grep", { timeout: 3000 }).toString("utf8");',
        '      const mPid = ps.match(/\\S+\\s+(\\d+)/);',
        '      const mCsrf = ps.match(/--csrf_token\\s+([a-zA-Z0-9_-]+)/);',
        '      if (mPid && mCsrf) {',
        '        const lsof = execSync("lsof -Pan -p " + mPid[1] + " -i", { timeout: 3000 }).toString("utf8");',
        '        const mPort = lsof.match(/127\\.0\\.0\\.1:(\\d+)\\s+\\(LISTEN\\)/);',
        '        if (mPort) return { port: Number(mPort[1]), csrf: mCsrf[1] };',
        '      }',
        '    } catch {}',
        '  }',
        '  return null;',
        '}',
        'async function sendMsg() {',
        '  try {',
        '    const srv = findAntigravityServer();',
        '    if (!srv) return { ok: false, error: "Antigravity language_server not found" };',
        '    const { port, csrf } = srv;',
        '    const agent = new https.Agent({ rejectUnauthorized: false });',
        `    const postData = JSON.stringify({
          cascadeId: "${conversationId}",
          items: [{ text: ${escapedPrompt} }],
          cascadeConfig: {
            plannerConfig: {
              requestedModel: { model: "${requestedModelId}" },
              plannerTypeConfig: {
                case: "conversational",
                value: { plannerMode: "DEFAULT", agenticMode: true }
              }
            }
          }
        });`,
        '    const sendRes = await new Promise((resolve) => {',
        '      const req = https.request({',
        '        hostname: "127.0.0.1",',
        '        port,',
        '        path: "/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",',
        '        method: "POST",',
        '        headers: {',
        '          "Content-Type": "application/json",',
        '          "X-Codeium-Csrf-Token": csrf,',
        '          "Connect-Protocol-Version": "1",',
        '          "Content-Length": Buffer.byteLength(postData)',
        '        },',
        '        agent,',
        '        timeout: 10000',
        '      }, (res) => {',
        '        let buf = "";',
        '        res.on("data", c => buf += c);',
        '        res.on("end", () => resolve({ status: res.statusCode, data: buf }));',
        '      });',
        '      req.on("error", (e) => resolve({ error: e.message }));',
        '      req.write(postData);',
        '      req.end();',
        '    });',
        '    if (sendRes.error) return { ok: false, error: sendRes.error };',
        '    const startedAt = Date.now();',
        '    let collectedEvents = [];',
        '    while (Date.now() - startedAt < 12000) {',
        '      try {',
        '        const trajReqData = JSON.stringify({ cascadeId: "' + conversationId + '" });',
        '        const trajRes = await new Promise((resolve) => {',
        '          const req = https.request({',
        '            hostname: "127.0.0.1",',
        '            port,',
        '            path: "/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory",',
        '            method: "POST",',
        '            headers: {',
        '              "Content-Type": "application/json",',
        '              "X-Codeium-Csrf-Token": csrf,',
        '              "Connect-Protocol-Version": "1",',
        '              "Content-Length": Buffer.byteLength(trajReqData)',
        '            },',
        '            agent,',
        '            timeout: 5000',
        '          }, (res) => {',
        '            let buf = "";',
        '            res.on("data", c => buf += c);',
        '            res.on("end", () => resolve(buf));',
        '          });',
        '          req.on("error", () => resolve(""));',
        '          req.write(trajReqData);',
        '          req.end();',
        '        });',
        '        if (trajRes) {',
        '          const parsed = JSON.parse(trajRes);',
        '          const steps = parsed.steps || parsed.trajectory?.steps || [];',
        '          const evts = [];',
        '          for (let i = 0; i < steps.length; i++) {',
        '            const st = steps[i];',
        '            const t = st.type || "";',
        '            const c = st.plannerResponse?.response || st.plannerResponse?.text || st.content || "";',
        '            if (t.includes("PLANNER_RESPONSE") || t.includes("ASSISTANT")) {',
        '              if (c) evts.push({ type: "assistant_text", text: c, seq: i + 1 });',
        '            } else if (t.includes("USER_INPUT")) {',
        '              const uc = st.userInput?.userResponse || st.userInput?.text || c || "";',
        '              if (uc) evts.push({ type: "user_text", text: uc, seq: i + 1 });',
        '            }',
        '          }',
        '          if (evts.length > 0) collectedEvents = evts;',
        '          const idle = /IDLE/i.test(parsed.status || "");',
        '          if (idle && collectedEvents.some(e => e.type === "assistant_text")) break;',
        '        }',
        '      } catch {}',
        '      await new Promise(r => setTimeout(r, 1000));',
        '    }',
        '    return { ok: true, events: collectedEvents };',
        '  } catch (e) {',
        '    return { ok: false, error: e.message };',
        '  }',
        '}',
        'sendMsg().then(r => console.log(JSON.stringify(r)));',
      ].join("\n");

      let events = [
        { type: "user_text", text: prompt },
      ];
      try {
        const raw = await runRemoteNodeScript(script, { timeoutMs: 20000 });
        const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.events) && parsed.events.length > 0) {
            events = parsed.events;
          }
        }
      } catch (err) {
        logger?.warn?.(`[ssh-host] SendUserCascadeMessage error: ${err.message}`);
      }

      return {
        turnId: `turn_${Date.now()}`,
        conversationId,
        events,
        status: "dispatched",
        model: requestedModelId,
      };
    },
    async *subscribeEvents({ conversationId, fromSeq = 0 } = {}) {
      yield {
        seq: fromSeq + 1,
        type: "system",
        summary: `Connected to remote Antigravity host over SSH (${host}:${port})`,
      };
    },
    async listPendingApprovals() {
      return [];
    },
    async decideApproval() {
      return { ok: true };
    },
  };
}
