import { BaseJobAdapter } from "./base-adapter.mjs";

export class ModelPricingAdapter extends BaseJobAdapter {
  constructor({ getEngine } = {}) {
    super({
      id: "model_pricing_refresh",
      name: "模型定价字典更新",
      module: "用量统计 (Token Analytics)",
      description: "定时从 LiteLLM 官方仓库抓取大模型最新定价与上下文窗口规格",
      scheduleSummary: "每 24 小时",
    });
    this.getEngine = getEngine || (() => null);
  }

  getStatus(jobConfig = {}) {
    const base = super.getStatus(jobConfig);
    const engine = this.getEngine();
    const stats = engine?.listPrices?.();

    const hours = jobConfig.interval_hours ?? 24;
    const isEnabled = jobConfig.enabled ?? true;

    return {
      ...base,
      enabled: isEnabled,
      status: isEnabled ? "idle" : "disabled",
      scheduleSummary: `每 ${hours} 小时`,
      lastMessage: stats?.models?.length
        ? `模型定价库已就绪，当前收录 ${stats.models.length} 个模型规格`
        : base.lastMessage,
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用模型定价字典自动同步", type: "boolean" },
      { key: "interval_hours", label: "同步间隔 (小时)", type: "number", min: 1, max: 168, help: "默认 24 小时" },
    ];
  }

  async runNow() {
    const engine = this.getEngine();
    if (!engine?.refresh) {
      throw new Error("模型定价引擎未就绪");
    }

    const success = await engine.refresh();
    const stats = engine.listPrices();
    if (!success) {
      throw new Error("远程定价表拉取失败，已使用本地兜底价格表");
    }

    return {
      ok: true,
      message: `模型定价库刷新成功，已同步 ${stats?.models?.length || 0} 个模型数据`,
    };
  }
}
