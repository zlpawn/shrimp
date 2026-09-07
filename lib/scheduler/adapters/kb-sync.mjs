import { BaseJobAdapter } from "./base-adapter.mjs";

export class KbSyncAdapter extends BaseJobAdapter {
  constructor({ getScheduler, getChannelSecrets } = {}) {
    super({
      id: "kb_incremental_sync",
      name: "知识库笔记增量同步",
      module: "知识库 (Knowledge Base)",
      description: "增量同步微信读书划线/想法与 Craft 笔记并建立向量索引",
      scheduleSummary: "每日 04:00 (或每 12 小时)",
    });
    this.getScheduler = getScheduler || (() => null);
    this.getChannelSecrets = getChannelSecrets || (() => null);
  }

  getStatus(jobConfig = {}) {
    const base = super.getStatus(jobConfig);
    const scheduler = this.getScheduler();
    const secrets = this.getChannelSecrets()?.load?.() || {};
    const schedule = secrets.schedule || {};

    const isEnabled = jobConfig.enabled ?? schedule.enabled ?? true;
    const mode = jobConfig.mode ?? schedule.mode ?? "daily";
    const dailyTime = jobConfig.daily_time ?? schedule.daily_time ?? "04:00";
    const intervalHours = jobConfig.interval_hours ?? schedule.interval_hours ?? 12;

    const summary = mode === "daily" ? `每日 ${dailyTime}` : `每 ${intervalHours} 小时`;
    const nextRun = scheduler?.getNextRunInfo?.();

    return {
      ...base,
      enabled: isEnabled,
      status: isEnabled ? "idle" : "disabled",
      scheduleSummary: summary,
      nextRunAt: nextRun?.timestamp ? new Date(nextRun.timestamp).toISOString() : null,
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用增量同步", type: "boolean" },
      {
        key: "mode",
        label: "调度模式",
        type: "select",
        options: [
          { label: "每日固定时间 (Daily)", value: "daily" },
          { label: "固定间隔小时 (Interval)", value: "interval" },
        ],
      },
      { key: "daily_time", label: "每日同步时间", type: "text", help: "如 04:00" },
      { key: "interval_hours", label: "间隔周期 (小时)", type: "number", min: 1, max: 168 },
      { key: "sync_on_startup", label: "网关启动时自动同步一次", type: "boolean" },
    ];
  }

  async runNow() {
    const scheduler = this.getScheduler();
    if (!scheduler) {
      throw new Error("知识库同步调度器尚未初始化");
    }

    const result = await scheduler.runSync({ trigger: "manual" });
    if (result && result.ok === false) {
      throw new Error(result.error || result.summary || "同步失败");
    }

    const highlights = result?.highlightsCount ?? 0;
    const reviews = result?.reviewsCount ?? 0;
    const message = result?.summary
      ? `同步完成: ${result.summary}`
      : `同步完成: 微信划线 +${highlights}，想法 +${reviews}`;
    return {
      ok: true,
      message,
    };
  }

  async onConfigChange(patch, updatedConfig) {
    const secrets = this.getChannelSecrets();
    const scheduler = this.getScheduler();

    if (secrets?.updateSchedule) {
      secrets.updateSchedule({
        enabled: updatedConfig.enabled,
        mode: updatedConfig.mode,
        daily_time: updatedConfig.daily_time,
        interval_hours: updatedConfig.interval_hours,
        sync_on_startup: updatedConfig.sync_on_startup,
      });
    }

    if (scheduler?.scheduleNext) {
      scheduler.scheduleNext();
    } else if (scheduler?.restart) {
      scheduler.restart();
    }
  }
}
