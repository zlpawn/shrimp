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

export function createSshHostBackend({
  peer,
  logger = console,
} = {}) {
  const id = peer?.id || "ssh-host";
  const host = peer?.transport?.host || "127.0.0.1";
  const port = peer?.transport?.port || 22;
  const user = peer?.auth?.ssh?.username || "root";
  const password = peer?.auth?.ssh?.password || "";
  const keyPath = peer?.auth?.ssh?.privateKeyPath;

  async function runRemoteNodeScript(script, { timeoutMs = 25000 } = {}) {
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
        'const home = os.homedir();',
        'const base = path.join(home, ".gemini", "antigravity");',
        'const brainDir = path.join(base, "brain");',
        'const projectsMap = new Map();',
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
        '    if (raw.startsWith("file:")) {',
        '      const u = new URL(raw.replace(/\\\\/g, "/"));',
        '      let p = decodeURIComponent(u.pathname || "");',
        '      if (/^[\\\\\\/][A-Za-z]:/.test(p)) p = p.slice(1);',
        '      return p.replace(/\\//g, path.sep);',
        '    }',
        '  } catch {}',
        '  return raw;',
        '}',
        'function extractProjectPath(project) {',
        '  const resources = project?.projectResources?.resources;',
        '  if (!Array.isArray(resources)) return "";',
        '  for (const resource of resources) {',
        '    const uri = resource?.gitFolder?.folderUri || resource?.folder?.folderUri || resource?.folderUri || "";',
        '    const p = fileUriToPath(uri);',
        '    if (p) return p;',
        '  }',
        '  return "";',
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
        '        const pPath = extractProjectPath(parsed) || id;',
        '        projectsMap.set(id, {',
        '          id,',
        '          name: String(parsed.name || id),',
        '          path: pPath,',
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
        '          let title = "";',
        '          let updatedAt = 0;',
        '          try { updatedAt = fs.statSync(logPath).mtimeMs; } catch {}',
        '          let matchedProjId = "";',
        '          for (const [pId, pObj] of projectsMap.entries()) {',
        '            if (content.includes(pObj.name) || (pObj.path && content.includes(pObj.path))) {',
        '              matchedProjId = pId;',
        '              break;',
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
          workspaceUris: ["file://${projectId.replace(/\\/g, "/")}"]
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
            model: model || "gemini-3.7-flash-high",
          };
        }
      } catch {}

      return {
        conversationId: `conv_${Date.now()}`,
        projectId,
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
