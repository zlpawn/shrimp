// Read-only Antigravity project store enumerator (filesystem).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

export function defaultProjectStoreDir(env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, ".gemini", "config", "projects");
}

function fileUriToPath(fileUri) {
  const raw = String(fileUri || "").trim();
  if (!raw) return "";
  try {
    if (raw.startsWith("file:")) {
      const u = new URL(raw);
      let p = decodeURIComponent(u.pathname || "");
      // Windows: /d:/path -> d:/path
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return p.replace(/\//g, path.sep);
    }
  } catch {
    // fall through
  }
  return raw;
}

function extractProjectPath(project) {
  const resources = project?.projectResources?.resources;
  if (!Array.isArray(resources)) return "";
  for (const resource of resources) {
    const uri =
      resource?.gitFolder?.folderUri ||
      resource?.folder?.folderUri ||
      resource?.folderUri ||
      "";
    const p = fileUriToPath(uri);
    if (p) return p;
  }
  return "";
}

export function listProjectsFromStore({
  storeDir = defaultProjectStoreDir(),
  readdirSync = fs.readdirSync,
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
} = {}) {
  if (!storeDir || !existsSync(storeDir)) return [];
  let names = [];
  try {
    names = readdirSync(storeDir);
  } catch {
    return [];
  }

  const projects = [];
  for (const name of names) {
    if (!String(name).toLowerCase().endsWith(".json")) continue;
    if (String(name).toLowerCase() === "outside-of-project.json") continue;
    const full = path.join(storeDir, name);
    try {
      if (!statSync(full).isFile()) continue;
      const raw = readFileSync(full, "utf8");
      const parsed = JSON.parse(raw);
      const id = String(parsed?.id || path.basename(name, ".json"));
      if (!id) continue;
      projects.push({
        id,
        name: String(parsed?.name || id),
        path: extractProjectPath(parsed),
        source: "filesystem-project-store",
        updatedAt: parsed?.updatedAt || null,
      });
    } catch {
      // skip unreadable/invalid project files
    }
  }

  projects.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return projects;
}

export function discoverDynamicLocalEndpoint({
  mainLogPath = "",
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
} = {}) {
  if (!mainLogPath || !existsSync(mainLogPath)) {
    return {
      url: "",
      port: 0,
      csrfToken: "",
      source: "",
    };
  }
  let text = "";
  try {
    text = readFileSync(mainLogPath, "utf8");
  } catch {
    return { url: "", port: 0, csrfToken: "", source: "" };
  }

  const localMatches = [...text.matchAll(/Local:\s+(https:\/\/127\.0\.0\.1:(\d+)\/?)/g)];
  const csrfMatches = [...text.matchAll(/--csrf_token\s+([A-Za-z0-9-]+)/gi)];
  const latestLocal = localMatches.length ? localMatches[localMatches.length - 1] : null;
  const latestCsrf = csrfMatches.length ? csrfMatches[csrfMatches.length - 1][1] : "";
  const url = latestLocal ? latestLocal[1].replace(/\/?$/, "/") : "";
  const port = latestLocal ? Number(latestLocal[2]) : 0;
  return {
    url,
    port,
    csrfToken: latestCsrf || "",
    source: mainLogPath,
  };
}

export function defaultAntigravityPaths(env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
  return {
    projectStoreDir: defaultProjectStoreDir(env),
    mainLogPath: path.join(roaming, "Antigravity", "logs", "main.log"),
    languageServerLogPath: path.join(roaming, "Antigravity", "logs", "language_server.log"),
    conversationsDir: path.join(home, ".gemini", "antigravity", "conversations"),
    appStoragePath: path.join(roaming, "Antigravity", "app_storage.json"),
    devtoolsActivePortPath: path.join(roaming, "Antigravity", "DevToolsActivePort"),
  };
}

export function summarizePartialHostSupport({ projects = [], endpoint = null } = {}) {
  return {
    listProjects: projects.length > 0,
    dynamicEndpoint: Boolean(endpoint?.url),
    createConversation: false,
    dispatchPrompt: false,
    subscribeEvents: false,
    decideApproval: false,
    jointVisibility: false,
  };
}

export { unique };
