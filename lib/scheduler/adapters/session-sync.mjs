import { BaseJobAdapter } from "./base-adapter.mjs";

export class SessionSyncAdapter extends BaseJobAdapter {
  constructor({ getDaemon } = {}) {
    super({
      id: "session_watcher_daemon",
      name: "跨客户端会话日志同步",
      module: "会话同步 (Session Sync)",
      description: "实时监听 Codex、Claude、Antigravity 会话日志变动，提取增量并生成摘要",
      scheduleSummary: "事件驱动 (1500ms 防抖)",
    });
    this.getDaemon = getDaemon || (() => null);
  }

  getStatus(jobConfig = {}) {
    const base = super.getStatus(jobConfig);
    const daemon = this.getDaemon();
    const isRunning = Boolean(daemon?.isRunning);

    const debounceMs = jobConfig.debounce_ms ?? daemon?.debounceMs ?? 1500;
    const isEnabled = jobConfig.enabled ?? isRunning ?? true;

    return {
      ...base,
      enabled: isEnabled,
      status: isEnabled ? (isRunning ? "idle" : "idle") : "disabled",
      scheduleSummary: `事件驱动 (${debounceMs}ms 防抖)`,
      lastMessage: isRunning ? "会话同步守护进程正在实时监听" : "会话同步守护进程未处于运行状态",
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用会话监听同步", type: "boolean" },
      { key: "debounce_ms", label: "变动防抖等待 (毫秒)", type: "number", min: 500, max: 10000, help: "默认 1500ms" },
    ];
  }

  async runNow() {
    const daemon = this.getDaemon();
    if (!daemon) {
      throw new Error("会话同步守护进程未初始化");
    }

    if (typeof daemon.scanExistingSessions === "function") {
      await daemon.scanExistingSessions();
      return {
        ok: true,
        message: "全量历史会话扫描与增量同步已完成",
      };
    }

    return {
      ok: true,
      message: "会话守护进程已刷新",
    };
  }

  async onConfigChange(patch, updatedConfig) {
    const daemon = this.getDaemon();
    if (!daemon) return;

    if (typeof patch.debounce_ms === "number") {
      daemon.debounceMs = patch.debounce_ms;
    }

    if (updatedConfig.enabled === false) {
      daemon.stop?.();
    } else if (!daemon.isRunning) {
      daemon.start?.();
    }
  }
}
