import { BaseJobAdapter } from "./base-adapter.mjs";

export class TrendCrawlAdapter extends BaseJobAdapter {
  constructor({ getService, getScheduler } = {}) {
    super({
      id: "trend_intel_crawl",
      name: "热点资讯周期抓取",
      module: "热点情报 (Trend Radar)",
      description: "定期抓取 GitHub Trending、HackerNews 等热榜并入库分析",
      scheduleSummary: "每 30 分钟",
    });
    this.getService = getService || (() => null);
    this.getScheduler = getScheduler || (() => null);
  }

  getStatus(jobConfig = {}) {
    const base = super.getStatus(jobConfig);
    const scheduler = this.getScheduler();
    const schedulerStatus = scheduler?.getStatus?.();

    const intervalMin = jobConfig.interval_minutes ?? schedulerStatus?.interval_minutes ?? 30;
    const isEnabled = jobConfig.enabled ?? schedulerStatus?.enabled ?? true;

    return {
      ...base,
      enabled: isEnabled,
      status: isEnabled ? (schedulerStatus?.running ? "idle" : "idle") : "disabled",
      scheduleSummary: `每 ${intervalMin} 分钟`,
      lastRunAt: schedulerStatus?.lastCrawlAt || base.lastRunAt,
      nextRunAt: schedulerStatus?.lastCrawlAt
        ? new Date(new Date(schedulerStatus.lastCrawlAt).getTime() + intervalMin * 60 * 1000).toISOString()
        : null,
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用抓取调度", type: "boolean" },
      { key: "interval_minutes", label: "抓取间隔 (分钟)", type: "number", min: 5, max: 1440, help: "推荐 15 ~ 60 分钟" },
    ];
  }

  async runNow() {
    const service = this.getService();
    if (!service) {
      throw new Error("Trend Intelligence 服务尚未初始化");
    }

    const result = await service.crawlOnce();
    const count = result?.count ?? (Array.isArray(result) ? result.length : 0);
    return {
      ok: true,
      message: `抓取完成，共处理 ${count} 条热榜资讯`,
    };
  }

  async onConfigChange(patch, updatedConfig) {
    const scheduler = this.getScheduler();
    if (!scheduler) return;

    if (updatedConfig.enabled === false) {
      scheduler.stop?.();
    } else {
      scheduler.stop?.();
      scheduler.start?.();
    }
  }
}
