// Probe local Antigravity host backend surfaces without asar patching.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  defaultInstallCandidates,
  resolveInstallRoot,
  collectScanTargets,
} from "../../antigravity/client-discovery.mjs";

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function defaultListProcesses({ platform = process.platform } = {}) {
  try {
    if (platform === "win32") {
      const res = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
      );
      if (res.status !== 0) return [];
      const parsed = JSON.parse(res.stdout || "[]");
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return rows.map((row) => ({
        pid: Number(row.ProcessId || 0),
        name: String(row.Name || ""),
        command: String(row.CommandLine || ""),
      }));
    }

    const res = spawnSync("ps", ["-ax", "-o", "pid=", "-o", "comm=", "-o", "command="], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (res.status !== 0) return [];
    return String(res.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          name: match[2],
          command: match[3],
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function looksLikeAntigravityProcess(row) {
  const blob = `${row?.name || ""} ${row?.command || ""}`.toLowerCase();
  return (
    blob.includes("antigravity") ||
    blob.includes("language_server") ||
    blob.includes("language-server")
  );
}

function fileExists(filePath, { existsSync = fs.existsSync, statSync = fs.statSync } = {}) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath, { existsSync = fs.existsSync, statSync = fs.statSync } = {}) {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export async function probeLocalAntigravityBackend({
  env = process.env,
  platform = process.platform,
  listProcesses = defaultListProcesses,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
  readdirSync = fs.readdirSync,
  request = null,
  candidatePorts = [6045, 6046],
} = {}) {
  const processes = (listProcesses({ platform, env }) || []).filter(looksLikeAntigravityProcess);
  const running = processes.length > 0;

  const installCandidates = defaultInstallCandidates(env, platform);
  const installRoot = resolveInstallRoot(installCandidates);
  const scanTargets = collectScanTargets(installRoot);
  const languageServerPath = scanTargets.find((item) =>
    String(item).toLowerCase().includes("language_server"),
  ) || "";

  const discoveryFiles = [];
  if (installRoot) {
    const maybeDirs = [
      path.join(installRoot, "logs"),
      path.join(installRoot, "resources"),
      path.join(os.homedir(), ".antigravity"),
      path.join(env.APPDATA || "", "Antigravity"),
      path.join(env.LOCALAPPDATA || "", "Antigravity"),
    ].filter(Boolean);
    for (const dir of maybeDirs) {
      if (!dirExists(dir, { existsSync, statSync })) continue;
      try {
        for (const name of readdirSync(dir)) {
          const lower = String(name).toLowerCase();
          if (
            lower.includes("persistent") ||
            lower.includes("agent") ||
            lower.includes("conversation") ||
            lower.endsWith(".log")
          ) {
            discoveryFiles.push(path.join(dir, name));
          }
        }
      } catch {
        // ignore unreadable dirs
      }
    }
  }

  const openPorts = [];
  if (typeof request === "function") {
    for (const port of candidatePorts) {
      const url = `http://127.0.0.1:${port}/`;
      try {
        const res = await request(url, { method: "GET" });
        openPorts.push({
          port,
          url,
          ok: Boolean(res?.ok),
          status: Number(res?.status || 0),
        });
      } catch (error) {
        openPorts.push({
          port,
          url,
          ok: false,
          status: 0,
          message: error?.message || String(error),
        });
      }
    }
  }

  const hasLanguageServerBinary = Boolean(
    languageServerPath && fileExists(languageServerPath, { existsSync, statSync }),
  );

  // Until a real attach surface is confirmed, report unsupported even if process is running.
  const supported = false;
  const reason = running
    ? "process_found_but_attach_surface_unconfirmed"
    : "process_not_found";

  return {
    running,
    supported,
    reason,
    platform,
    installRoot: installRoot || "",
    languageServerPath,
    hasLanguageServerBinary,
    processes: processes.map((row) => ({
      pid: row.pid,
      name: row.name,
      command: row.command,
    })),
    scanTargets,
    discoveryFiles: unique(discoveryFiles).slice(0, 50),
    openPorts,
    capabilities: {
      processPresence: running,
      installDiscovery: Boolean(installRoot),
      languageServerBinary: hasLanguageServerBinary,
      localPortProbe: openPorts.some((item) => item.ok),
      projectList: false,
      conversationCreate: false,
      eventSubscribe: false,
      approvalDecide: false,
      jointVisibility: false,
    },
    measuredAt: new Date().toISOString(),
  };
}
