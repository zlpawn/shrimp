import { BaseJobAdapter } from "./base-adapter.mjs";

export class TrendBriefAdapter extends BaseJobAdapter {
  constructor({ getService, getScheduler } = {}) {
    super({
      id: "trend_intel_daily_brief",
      name: "AI 早晚报自动生成",
      module: "热点情报 (Trend Radar)",
      description: "汇聚全网当日资讯，调用大模型自动生成 AI 趋势早报/晚报",
      scheduleSummary: "每日 08:30, 18:00",
    });
    this.getService = getService || (() => null);
    this.getScheduler = getScheduler || (() => null);
  }

  getStatus(jobConfig = {}) {
    const base = super.getStatus(jobConfig);
    const scheduler = this.getScheduler();
    const schedulerStatus = scheduler?.getStatus?.();

    const dailyTimes = Array.isArray(jobConfig.daily_times)
      ? jobConfig.daily_times
      : (schedulerStatus?.daily_brief_times || ["08:30", "18:00"]);
    const isEnabled = jobConfig.enabled ?? schedulerStatus?.enabled ?? true;

    return {
      ...base,
      enabled: isEnabled,
      status: isEnabled ? "idle" : "disabled",
      scheduleSummary: `每日 ${dailyTimes.join(", ")}`,
      lastRunAt: schedulerStatus?.lastBriefAt || base.lastRunAt,
      nextRunAt: this._calculateNextDailyRun(dailyTimes),
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用早晚报生成", type: "boolean" },
      { key: "daily_times", label: "触发时间点 (逗号分隔)", type: "string_list", help: "如 08:30, 18:00" },
    ];
  }

  async runNow() {
    const service = this.getService();
    if (!service) {
      throw new Error("Trend Intelligence 服务尚未初始化");
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const brief = await service.generateBriefOnce({ date: todayStr });
    const title = brief?.title || "最新 AI 简报";
    return {
      ok: true,
      message: `简报生成成功: 《${title}》`,
    };
  }

  _calculateNextDailyRun(times) {
    if (!Array.isArray(times) || times.length === 0) return null;
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const currentMinutes = currentH * 60 + currentM;

    let targetDate = new Date(now);
    let targetMinutes = null;

    // Find the earliest time today after current time
    for (const t of times) {
      const [h, m] = String(t).split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        const mins = h * 60 + m;
        if (mins > currentMinutes) {
          if (targetMinutes === null || mins < targetMinutes) {
            targetMinutes = mins;
          }
        }
      }
    }

    if (targetMinutes !== null) {
      targetDate.setHours(Math.floor(targetMinutes / 60), targetMinutes % 60, 0, 0);
      return targetDate.toISOString();
    }

    // Otherwise target the first time tomorrow
    let firstTomorrow = null;
    for (const t of times) {
      const [h, m] = String(t).split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        const mins = h * 60 + m;
        if (firstTomorrow === null || mins < firstTomorrow) {
          firstTomorrow = mins;
        }
      }
    }

    if (firstTomorrow !== null) {
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(Math.floor(firstTomorrow / 60), firstTomorrow % 60, 0, 0);
      return targetDate.toISOString();
    }

    return null;
  }
}
