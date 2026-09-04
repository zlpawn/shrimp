import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { CodexhostIntegrationError } from "./errors.mjs";
import { defaultRuntimeDescriptorPath } from "./discovery.mjs";

const execFileP = promisify(execFile);

function validDescriptor(value) {
  return value
    && Object.keys(value).sort().join(",") === "control_port,launcher_pid,nonce,schema_version"
    && value.schema_version === 1
    && Number.isInteger(value.launcher_pid) && value.launcher_pid > 0
    && Number.isInteger(value.control_port) && value.control_port > 0 && value.control_port <= 65535
    && /^[0-9a-f]{32}$/.test(value.nonce);
}

export async function readRuntimeDescriptor({ descriptorPath = defaultRuntimeDescriptorPath() } = {}) {
  let metadata;
  try {
    metadata = fs.statSync(descriptorPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > 4096) {
    throw new CodexhostIntegrationError("runtime_not_managed", "codexhost Runtime Descriptor 无效。", { descriptorPath });
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  } catch {
    throw new CodexhostIntegrationError("runtime_not_managed", "codexhost Runtime Descriptor 无法解析。", { descriptorPath });
  }
  if (!validDescriptor(value)) {
    throw new CodexhostIntegrationError("runtime_not_managed", "codexhost Runtime Descriptor 未通过严格校验。", { descriptorPath });
  }
  return { ...value, path: descriptorPath };
}

export function probeRuntimeControl(descriptor, { timeoutMs = 500 } = {}) {
  if (!validDescriptor(descriptor)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: descriptor.control_port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function inspectCodexhostInstallation(executable, { execFileImpl = execFileP } = {}) {
  if (!executable?.entrypointPath) return { desktopExecutable: "", desktopLauncher: "", desktopProcessIds: [] };
  const { stdout } = await execFileImpl(process.execPath, [executable.entrypointPath, "inspect"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  const values = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return {
    desktopExecutable: values.desktop_executable || "",
    desktopLauncher: values.desktop_launcher || values.desktop_executable || "",
    desktopProcessIds: String(values.desktop_process_ids || "")
      .split(",").map(Number).filter((pid) => Number.isInteger(pid) && pid > 0),
    version: values.desktop_version || "",
    build: values.desktop_build || "",
  };
}

export async function processExecutablePath(pid, { platform = process.platform, execFileImpl = execFileP } = {}) {
  if (platform === "win32") {
    const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${Number(pid)}\").ExecutablePath`;
    const { stdout } = await execFileImpl("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8", windowsHide: true, timeout: 8000,
    });
    return String(stdout || "").trim();
  }
  if (platform === "darwin") {
    try {
      const { stdout } = await execFileImpl("ps", ["-p", String(Number(pid)), "-o", "comm="], {
        encoding: "utf8", timeout: 8000,
      });
      return String(stdout || "").trim();
    } catch {
      return "";
    }
  }
  try { return fs.realpathSync(`/proc/${Number(pid)}/exe`); } catch { return ""; }
}

export function isProcessAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

export async function terminateProcess(
  pid,
  {
    platform = process.platform,
    execFileImpl = execFileP,
    isProcessAlive: pidAlive = isProcessAlive,
    sendSignal = process.kill,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 5000,
  } = {},
) {
  if (platform === "win32") {
    await execFileImpl("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    return;
  }
  sendSignal(Number(pid), "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (await pidAlive(Number(pid)) && Date.now() < deadline) {
    await sleep(100);
  }
  if (await pidAlive(Number(pid))) {
    throw new CodexhostIntegrationError(
      "process_error",
      `codexhost Launcher PID ${Number(pid)} did not exit after SIGTERM.`,
      { pid: Number(pid) },
    );
  }
}

export function spawnDetached(command, args, options = {}) {
  return spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true, ...options });
}

export function defaultCodexConfigPath() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
}
