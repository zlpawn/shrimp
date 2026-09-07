/**
 * Base abstract class for all Job Adapters in Shrimp Gateway.
 * Adheres to the Open-Closed Principle (OCP).
 */
export class BaseJobAdapter {
  constructor({
    id,
    name,
    module,
    description,
    scheduleSummary = "",
  } = {}) {
    if (!id) throw new Error("JobAdapter requires an id");
    this.id = id;
    this.name = name || id;
    this.module = module || "系统";
    this.description = description || "";
    this.scheduleSummary = scheduleSummary;
    this.recentRuns = [];
    this.lastRunAt = null;
    this.lastDurationMs = 0;
    this.lastError = null;
    this.lastMessage = null;
  }

  recordRun({ success, durationMs, message, error }) {
    this.lastRunAt = new Date().toISOString();
    this.lastDurationMs = durationMs;
    this.lastError = error || null;
    this.lastMessage = message || (success ? "执行成功" : (error || "执行失败"));

    const entry = {
      timestamp: this.lastRunAt,
      durationMs,
      success,
      message: this.lastMessage,
      error: this.lastError,
    };
    this.recentRuns.unshift(entry);
    if (this.recentRuns.length > 10) {
      this.recentRuns.length = 10;
    }
  }

  /**
   * Return real-time status of the job.
   * @param {Record<string, any>} jobConfig
   * @returns {{
   *   status: 'idle' | 'running' | 'error' | 'disabled',
   *   enabled: boolean,
   *   scheduleSummary: string,
   *   lastRunAt: string | null,
   *   lastDurationMs: number,
   *   nextRunAt: string | null,
   *   lastError: string | null,
   *   lastMessage: string | null
   * }}
   */
  getStatus(jobConfig = {}) {
    return {
      status: jobConfig.enabled === false ? "disabled" : "idle",
      enabled: jobConfig.enabled !== false,
      scheduleSummary: this.scheduleSummary,
      lastRunAt: this.lastRunAt,
      lastDurationMs: this.lastDurationMs,
      nextRunAt: null,
      lastError: this.lastError,
      lastMessage: this.lastMessage,
    };
  }

  /**
   * Return schema definition for in-card collapsible configuration form.
   * Types: 'boolean', 'number', 'text', 'select', 'string_list'
   * @returns {Array<{ key: string, label: string, type: string, min?: number, max?: number, step?: number, options?: Array<{ label: string, value: any }>, help?: string }>}
   */
  getSchema() {
    return [
      { key: "enabled", label: "启用任务", type: "boolean" },
    ];
  }

  /**
   * Execute task immediately.
   * @param {Record<string, any>} jobConfig
   * @returns {Promise<{ ok: boolean, durationMs: number, message?: string, error?: string }>}
   */
  async runNow(jobConfig = {}) {
    throw new Error(`runNow is not implemented for job: ${this.id}`);
  }

  /**
   * Hook called when user updates config in scheduler.config.json.
   * @param {Record<string, any>} patch
   * @param {Record<string, any>} updatedJobConfig
   */
  async onConfigChange(patch, updatedJobConfig) {
    // Implemented by subclasses to hot-reconfigure internal timers
  }
}
