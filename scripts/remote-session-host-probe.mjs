import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  defaultInstallCandidates,
  resolveInstallRoot,
  collectScanTargets,
} from "../lib/antigravity/client-discovery.mjs";
import { probeLocalAntigravityBackend } from "../lib/remote-session/host-attach/probe.mjs";

function listProcessesWin() {
  const script = `
  $procs = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match 'Antigravity|language_server|Codex|ChatGPT' -or
      ($_.CommandLine -and ($_.CommandLine -match 'Antigravity|language_server|Codex|ChatGPT'))
    } |
    Select-Object ProcessId, Name, ExecutablePath, CommandLine;
  $procs | ConvertTo-Json -Compress
  `;
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  if (res.status !== 0) {
    return {
      ok: false,
      error: (res.stderr || res.stdout || "process list failed").trim(),
      rows: [],
    };
  }
  try {
    const parsed = JSON.parse(res.stdout || "[]");
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return {
      ok: true,
      rows: rows.map((row) => ({
        pid: Number(row.ProcessId || 0),
        name: String(row.Name || ""),
        executablePath: String(row.ExecutablePath || ""),
        command: String(row.CommandLine || ""),
      })),
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error), rows: [] };
  }
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function listInterestingFiles(root, max = 40) {
  const out = [];
  if (!root || !exists(root)) return out;
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const lower = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        if (
          lower.includes("log") ||
          lower.includes("state") ||
          lower.includes("cache") ||
          lower.includes("session") ||
          lower.includes("agent") ||
          lower.includes("conversation") ||
          lower.includes("persistent")
        ) {
          stack.push(full);
        }
        continue;
      }
      if (
        lower.includes("log") ||
        lower.includes("port") ||
        lower.includes("socket") ||
        lower.includes("pipe") ||
        lower.includes("persistent") ||
        lower.includes("agent") ||
        lower.includes("conversation") ||
        lower.endsWith(".json") ||
        lower.endsWith(".db") ||
        lower.endsWith(".sqlite")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

async function probePort(port) {
  const url = `http://127.0.0.1:${port}/`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 800);
  try {
    const res = await fetch(url, { method: "GET", signal: ac.signal });
    const text = await res.text().catch(() => "");
    return {
      port,
      url,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      bodyPreview: String(text || "").slice(0, 180),
    };
  } catch (error) {
    return {
      port,
      url,
      ok: false,
      status: 0,
      message: error?.name === "AbortError" ? "timeout" : error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyProcess(row) {
  const blob = `${row.name} ${row.executablePath} ${row.command}`.toLowerCase();
  return {
    ...row,
    kind: blob.includes("antigravity")
      ? "antigravity"
      : blob.includes("language_server")
        ? "language_server"
        : blob.includes("codex") || blob.includes("chatgpt")
          ? "codex_or_chatgpt"
          : "other",
  };
}

const installCandidates = defaultInstallCandidates(process.env, process.platform);
const installRoot = resolveInstallRoot(installCandidates);
const scanTargets = collectScanTargets(installRoot);
const processes = listProcessesWin();
const classified = (processes.rows || []).map(classifyProcess);

const localProbe = await probeLocalAntigravityBackend({
  listProcesses: () =>
    classified.map((row) => ({
      pid: row.pid,
      name: row.name,
      command: row.command,
    })),
  request: async (url) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 800);
    try {
      return await fetch(url, { method: "GET", signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  },
  candidatePorts: [6045, 6046, 8787, 8788, 9222, 19222],
});

const home = process.env.USERPROFILE || os.homedir();
const interestingDirs = [
  installRoot,
  path.join(home, "AppData", "Roaming", "Antigravity"),
  path.join(home, "AppData", "Local", "Antigravity"),
  path.join(home, ".antigravity"),
  path.join(home, "AppData", "Roaming", "Codex"),
  path.join(home, "AppData", "Local", "Codex"),
].filter(Boolean);

const interestingFiles = [];
for (const dir of interestingDirs) {
  for (const file of listInterestingFiles(dir, 25)) {
    interestingFiles.push(file);
  }
}

const ports = [];
for (const port of [6045, 6046, 8787, 8788, 9222, 19222, 7500]) {
  ports.push(await probePort(port));
}

const report = {
  measuredAt: new Date().toISOString(),
  platform: process.platform,
  note: "Read-only probe only. No gateway start, no desktop launch/restart, no process kill.",
  install: {
    candidates: installCandidates,
    installRoot: installRoot || "",
    scanTargets,
    languageServerBinary: scanTargets.find((item) =>
      String(item).toLowerCase().includes("language_server"),
    ) || "",
  },
  processes: {
    ok: processes.ok,
    error: processes.error || "",
    antigravity: classified.filter((row) => row.kind === "antigravity"),
    languageServer: classified.filter((row) => row.kind === "language_server"),
    codexOrChatgpt: classified.filter((row) => row.kind === "codex_or_chatgpt"),
    otherMatched: classified.filter((row) => row.kind === "other"),
  },
  localProbe,
  ports,
  interestingFiles: [...new Set(interestingFiles)].slice(0, 80),
};

const outDir = path.join("docs", "superpowers", "specs");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "2026-08-15-antigravity-host-backend-probe-result.json");
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({
  outFile,
  installRoot: report.install.installRoot,
  antigravityProcessCount: report.processes.antigravity.length,
  languageServerProcessCount: report.processes.languageServer.length,
  codexOrChatgptProcessCount: report.processes.codexOrChatgpt.length,
  openPorts: report.ports.filter((p) => p.ok).map((p) => p.port),
  localProbeReason: report.localProbe.reason,
  localProbeSupported: report.localProbe.supported,
  interestingFileCount: report.interestingFiles.length,
}, null, 2));

