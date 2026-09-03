import fs from "node:fs";
import path from "node:path";
import { discoverCodexhostExecutable } from "./discovery.mjs";
import { inspectCodexConfig } from "./config-guard.mjs";
import { CodexhostIntegrationError } from "./errors.mjs";
import {
  defaultCodexConfigPath,
  inspectCodexhostInstallation,
  isProcessAlive,
  processExecutablePath,
  probeRuntimeControl,
  readRuntimeDescriptor,
  spawnDetached,
  terminateProcess,
} from "./process-manager.mjs";
import { codexhostPublicStatus } from "./status.mjs";

function sameExecutable(left, right, platform) {
  if (!left || !right) return false;
  const normalize = platform === "win32"
    ? (value) => path.win32.normalize(String(value)).toLowerCase()
    : (value) => path.resolve(String(value));
  return normalize(left) === normalize(right);
}

async function defaultGatewayProbe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    return { ...(await response.json()), port };
  } catch {
    return null;
  }
}

async function defaultConfigReader() {
  const configPath = defaultCodexConfigPath();
  try { return { path: configPath, text: fs.readFileSync(configPath, "utf8") }; }
  catch { return { path: configPath, text: "" }; }
}

export function createCodexhostService({
  platform = process.platform,
  gatewayPort = Number(process.env.PORT || process.env.GATEWAY_PORT || 8787),
  discoverExecutable = () => discoverCodexhostExecutable({ platform }),
  inspectInstallation = (executable) => inspectCodexhostInstallation(executable),
  readRuntimeDescriptor: readDescriptor = () => readRuntimeDescriptor(),
  probeRuntimeControl: probeControl = (descriptor) => probeRuntimeControl(descriptor),
  probeGateway = () => defaultGatewayProbe(gatewayPort),
  readCodexConfig = defaultConfigReader,
  processExecutablePath: resolveProcessExecutable = (pid) => processExecutablePath(pid, { platform }),
  isProcessAlive: pidAlive = isProcessAlive,
  spawnProcess = spawnDetached,
  terminateProcess: terminate = (pid) => terminateProcess(pid, { platform }),
  now = () => new Date(),
} = {}) {
  let launchingUntil = 0;

  async function snapshot(operation = "") {
    const executable = await discoverExecutable();
    let installation = { desktopExecutable: "", desktopLauncher: "", desktopProcessIds: [] };
    if (executable) {
      try { installation = await inspectInstallation(executable); } catch {}
    }
    let descriptor = null;
    let descriptorError = null;
    try {
      descriptor = await readDescriptor();
    } catch (error) {
      if (operation === "openOfficial") {
        throw new CodexhostIntegrationError(
          "runtime_state_unavailable",
          "无法确认 codexhost Runtime Descriptor 状态；暂不切换普通模式。",
          { reason: error?.message || String(error) },
        );
      }
      descriptorError = error;
    }
    const controlReady = descriptor ? await probeControl(descriptor) : false;
    const gateway = await probeGateway();
    const configSource = await readCodexConfig();
    const config = inspectCodexConfig(configSource?.text || "", {
      configPath: configSource?.path || "",
      gatewayPort,
    });
    const launching = !descriptor && now().getTime() < launchingUntil;
    return { executable, installation, descriptor, controlReady, gateway, config, launching, descriptorError };
  }

  async function requireManagedOwner(state) {
    const descriptor = state.descriptor;
    if (!descriptor || !state.controlReady || !(await pidAlive(descriptor.launcher_pid))) {
      throw new CodexhostIntegrationError("runtime_not_managed", "没有可由此页面安全停止的 codexhost 实例。");
    }
    const actual = await resolveProcessExecutable(descriptor.launcher_pid);
    if (!sameExecutable(actual, state.executable?.launcherPath, platform)) {
      throw new CodexhostIntegrationError(
        "runtime_owner_mismatch",
        "Runtime Descriptor 的进程所有者与已安装的 codexhost Launcher 不匹配，已拒绝停止。",
        { pid: descriptor.launcher_pid, expected: state.executable?.launcherPath || "", actual },
      );
    }
    return descriptor;
  }

  return {
    async getStatus() {
      const state = await snapshot();
      return codexhostPublicStatus({
        ...state,
        error: state.descriptorError,
      });
    },

    async start() {
      if (!(["win32", "darwin", "linux"].includes(platform))) {
        throw new CodexhostIntegrationError("unsupported_platform", `当前平台 ${platform} 不支持 codexhost。`);
      }
      const state = await snapshot();
      if (!state.executable) throw new CodexhostIntegrationError("executable_not_found", "未安装 codexhost，请先安装 @codexhost/cli。");
      if (!(state.gateway?.ok && state.gateway?.service === "shrimp")) {
        throw new CodexhostIntegrationError("gateway_offline", `Shrimp 网关端口 ${gatewayPort} 未通过健康检查，请先启动网关。`);
      }
      if (!state.config.healthy) {
        throw new CodexhostIntegrationError("codex_config_invalid", "Codex 模型配置未指向当前 Shrimp 网关；为保护现有配置，codexhost 未启动。", { issues: state.config.issues });
      }
      if (state.descriptor && state.controlReady) return this.getStatus();
      if (state.installation.desktopProcessIds.length) {
        throw new CodexhostIntegrationError("desktop_conflict", "Codex Desktop 已在普通模式运行。请完全退出后再启动增强模式。", { desktopPids: state.installation.desktopProcessIds });
      }
      const child = spawnProcess(process.execPath, [state.executable.entrypointPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child?.unref?.();
      launchingUntil = now().getTime() + 120000;
      return codexhostPublicStatus({ ...state, launching: true });
    },

    async stop({ confirmInterrupt = false } = {}) {
      if (!confirmInterrupt) {
        throw new CodexhostIntegrationError(
          "confirmation_required",
          "停止增强模式会关闭当前 Codex Desktop，未完成任务可能被中断。请明确确认后继续。",
        );
      }
      const state = await snapshot();
      const descriptor = await requireManagedOwner(state);
      await terminate(descriptor.launcher_pid);
      launchingUntil = 0;
      return this.getStatus();
    },

    async openOfficial({ confirmInterrupt = false } = {}) {
      let state = await snapshot("openOfficial");
      if (state.descriptor && state.controlReady) {
        if (!confirmInterrupt) {
          throw new CodexhostIntegrationError(
            "confirmation_required",
            "切换到普通模式会关闭当前 Codex Desktop，未完成任务可能被中断。请明确确认后继续。",
          );
        }
        const descriptor = await requireManagedOwner(state);
        await terminate(descriptor.launcher_pid);
        launchingUntil = 0;
        state = await snapshot("openOfficial");
      }
      if (state.installation.desktopProcessIds.length) {
        throw new CodexhostIntegrationError("desktop_conflict", "Codex Desktop 已在运行，无需重复启动。", { desktopPids: state.installation.desktopProcessIds });
      }
      const launcher = state.installation.desktopLauncher || state.installation.desktopExecutable;
      if (!launcher) throw new CodexhostIntegrationError("executable_not_found", "未找到官方 Codex Desktop 启动程序。");
      const child = spawnProcess(launcher, [], { detached: true, stdio: "ignore", windowsHide: true });
      child?.unref?.();
      return { ...(await this.getStatus()), mode: "official" };
    },
  };
}
