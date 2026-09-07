import { BaseJobAdapter } from "./base-adapter.mjs";

export class KanbanDispatchAdapter extends BaseJobAdapter {
  constructor({ getScheduler, getService } = {}) {
    super({
      id: "session_kanban_dispatch",
      name: "会话看板队列派发",
      module: "会话看板 (Session Kanban)",
      description: "定时扫描排队表，触发延时到期或配额恢复的消息自动向 CLI 派发",
      scheduleSummary: "每 30 秒",
    });
    this.getScheduler = getScheduler || (() => null);
    this.getService = getService || (() => null);
  }

  getStatus(jobConfig = {}) {
    const base = super.getStatus(jobConfig);
    const intervalSec = jobConfig.interval_seconds ?? 30;
    const isEnabled = jobConfig.enabled ?? true;

    return {
      ...base,
      enabled: isEnabled,
      status: isEnabled ? "idle" : "disabled",
      scheduleSummary: `每 ${intervalSec} 秒`,
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用看板队列轮询", type: "boolean" },
      { key: "interval_seconds", label: "轮询间隔 (秒)", type: "number", min: 5, max: 300, help: "推荐 15 ~ 60 秒" },
    ];
  }

  async runNow() {
    const service = this.getService();
    const scheduler = this.getScheduler();

    if (scheduler?.runOnce) {
      await scheduler.runOnce();
      return { ok: true, message: "已执行一次看板排队扫描与派发检查" };
    }

    if (service?.dispatchReady) {
      const dispatched = await service.dispatchReady();
      return { ok: true, message: `排队扫描完成，成功派发 ${dispatched?.length || 0} 条就绪消息` };
    }

    throw new Error("Session Kanban 服务尚未初始化");
  }

  async onConfigChange(patch, updatedConfig) {
    const scheduler = this.getScheduler();
    if (!scheduler) return;

    // Apply the new interval first (re-arms the timer in place)
    if (typeof updatedConfig.interval_seconds === "number" && scheduler.setIntervalMs) {
      scheduler.setIntervalMs(updatedConfig.interval_seconds * 1000);
    }

    if (updatedConfig.enabled === false) {
      scheduler.stop?.();
    } else {
      scheduler.start?.();
    }
  }
}
