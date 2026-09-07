import { BaseJobAdapter } from "./base-adapter.mjs";

export class FxRateAdapter extends BaseJobAdapter {
  constructor({ getService } = {}) {
    super({
      id: "fx_rate_refresh",
      name: "实时汇率自动更新",
      module: "用量统计 (Token Analytics)",
      description: "定时请求实时汇率 API，获取最新的 USD/CNY 牌价供 Token 计费折算",
      scheduleSummary: "每 6 小时",
    });
    this.getService = getService || (() => null);
  }

  getStatus(jobConfig = {}) {
    const base = super.getStatus(jobConfig);
    const service = this.getService();
    const rateInfo = service?.getRate?.();

    const hours = jobConfig.interval_hours ?? 6;
    const isEnabled = jobConfig.enabled ?? true;

    return {
      ...base,
      enabled: isEnabled,
      status: isEnabled ? "idle" : "disabled",
      scheduleSummary: `每 ${hours} 小时`,
      lastRunAt: rateInfo?.updated_at ? new Date(rateInfo.updated_at).toISOString() : base.lastRunAt,
      lastMessage: rateInfo?.usd_to_cny
        ? `当前牌价: 1 USD = ${Number(rateInfo.usd_to_cny).toFixed(4)} CNY (来源: ${rateInfo.source})`
        : base.lastMessage,
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用汇率定时更新", type: "boolean" },
      { key: "interval_hours", label: "更新间隔 (小时)", type: "number", min: 1, max: 72, help: "默认 6 小时" },
    ];
  }

  async runNow() {
    const service = this.getService();
    if (!service?.refresh) {
      throw new Error("汇率服务未就绪");
    }

    const success = await service.refresh();
    const rateInfo = service.getRate();
    if (!success) {
      throw new Error("汇率接口请求失败，已回退至预设汇率");
    }

    return {
      ok: true,
      message: `汇率刷新成功: 1 USD = ${Number(rateInfo.usd_to_cny).toFixed(4)} CNY`,
    };
  }

  async onConfigChange(patch, updatedConfig) {
    const service = this.getService();
    if (!service) return;

    if (typeof updatedConfig.interval_hours === "number" && service.setRefreshIntervalHours) {
      service.setRefreshIntervalHours(updatedConfig.interval_hours);
    }

    if (updatedConfig.enabled === false) {
      service.stopRefresh?.();
    } else {
      service.startRefresh?.();
    }
  }
}
