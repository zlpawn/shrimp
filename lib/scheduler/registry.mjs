export class JobRegistry {
  constructor({ configStore, logger = console } = {}) {
    this.configStore = configStore;
    this.logger = logger;
    this.adapters = new Map();
    this.runningJobs = new Set();
  }

  register(adapter) {
    if (!adapter?.id) {
      throw new Error("Cannot register adapter without id");
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(jobId) {
    return this.adapters.get(jobId) || null;
  }

  getAll() {
    return Array.from(this.adapters.values());
  }

  listJobs() {
    const list = [];
    for (const [id, adapter] of this.adapters.entries()) {
      const config = this.configStore ? this.configStore.getJobConfig(id) || {} : {};
      const status = adapter.getStatus(config);
      const isRunning = this.runningJobs.has(id);

      list.push({
        id,
        name: adapter.name,
        module: adapter.module,
        description: adapter.description,
        scheduleSummary: status.scheduleSummary || adapter.scheduleSummary,
        status: isRunning ? "running" : status.status,
        enabled: status.enabled,
        lastRunAt: status.lastRunAt,
        lastDurationMs: status.lastDurationMs,
        nextRunAt: status.nextRunAt,
        lastError: status.lastError,
        lastMessage: status.lastMessage,
        config,
        schema: adapter.getSchema(),
        recentRuns: adapter.recentRuns || [],
      });
    }
    return list;
  }

  async runJob(jobId) {
    const adapter = this.get(jobId);
    if (!adapter) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (this.runningJobs.has(jobId)) {
      return {
        ok: false,
        error: `任务 [${adapter.name}] 正在运行中，请勿重复触发`,
      };
    }

    const config = this.configStore ? this.configStore.getJobConfig(jobId) || {} : {};
    this.runningJobs.add(jobId);
    const startTime = Date.now();

    try {
      this.logger.info?.(`[JobRegistry] Manually triggering job: ${jobId} (${adapter.name})`);
      const result = await adapter.runNow(config);
      const durationMs = Date.now() - startTime;
      const success = result?.ok !== false;
      const message = result?.message || (success ? "执行成功" : result?.error || "执行失败");
      const error = result?.error || (success ? null : message);

      adapter.recordRun({
        success,
        durationMs,
        message,
        error,
      });

      return {
        ok: success,
        durationMs,
        message,
        error,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err?.message || String(err);
      adapter.recordRun({
        success: false,
        durationMs,
        message: `执行发生异常: ${errorMsg}`,
        error: errorMsg,
      });
      return {
        ok: false,
        durationMs,
        error: errorMsg,
      };
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  async updateJobConfig(jobId, patch) {
    const adapter = this.get(jobId);
    if (!adapter) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updatedConfig = this.configStore
      ? this.configStore.updateJobConfig(jobId, patch)
      : { ...patch };

    try {
      await adapter.onConfigChange(patch, updatedConfig);
    } catch (err) {
      this.logger.warn?.(`[JobRegistry] Failed to apply onConfigChange for ${jobId}: ${err.message}`);
    }

    const status = adapter.getStatus(updatedConfig);
    return {
      id: jobId,
      name: adapter.name,
      module: adapter.module,
      description: adapter.description,
      scheduleSummary: status.scheduleSummary || adapter.scheduleSummary,
      status: this.runningJobs.has(jobId) ? "running" : status.status,
      enabled: status.enabled,
      lastRunAt: status.lastRunAt,
      lastDurationMs: status.lastDurationMs,
      nextRunAt: status.nextRunAt,
      lastError: status.lastError,
      lastMessage: status.lastMessage,
      config: updatedConfig,
      schema: adapter.getSchema(),
      recentRuns: adapter.recentRuns || [],
    };
  }
}
