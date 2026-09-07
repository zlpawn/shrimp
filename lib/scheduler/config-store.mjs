import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SCHEDULER_CONFIG = {
  version: 1,
  jobs: {
    trend_intel_crawl: {
      enabled: true,
      interval_minutes: 30,
    },
    trend_intel_daily_brief: {
      enabled: true,
      daily_times: ["08:30", "18:00"],
    },
    kb_incremental_sync: {
      enabled: true,
      mode: "daily",
      daily_time: "04:00",
      interval_hours: 12,
      sync_on_startup: true,
    },
    session_kanban_dispatch: {
      enabled: true,
      interval_seconds: 30,
    },
    fx_rate_refresh: {
      enabled: true,
      interval_hours: 6,
    },
    model_pricing_refresh: {
      enabled: true,
      interval_hours: 24,
    },
    session_watcher_daemon: {
      enabled: true,
      debounce_ms: 1500,
    },
  },
};

export class SchedulerConfigStore {
  constructor({
    configPath,
    exampleConfigPath,
    logger = console,
  } = {}) {
    this.configPath = configPath || path.resolve(process.cwd(), "scheduler.config.json");
    this.exampleConfigPath = exampleConfigPath || path.resolve(process.cwd(), "scheduler.config.example.json");
    this.logger = logger;
    this._cachedConfig = null;
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf-8");
        const parsed = JSON.parse(raw);
        this._cachedConfig = this._mergeWithDefaults(parsed);
        return this._cachedConfig;
      }
    } catch (err) {
      this.logger.warn?.(`[SchedulerConfigStore] Failed to read config from ${this.configPath}: ${err.message}, falling back to defaults`);
    }

    // Try reading example config
    try {
      if (fs.existsSync(this.exampleConfigPath)) {
        const raw = fs.readFileSync(this.exampleConfigPath, "utf-8");
        const parsed = JSON.parse(raw);
        this._cachedConfig = this._mergeWithDefaults(parsed);
        // Persist to actual configPath if it didn't exist
        this.save(this._cachedConfig);
        return this._cachedConfig;
      }
    } catch {
      // ignore
    }

    this._cachedConfig = JSON.parse(JSON.stringify(DEFAULT_SCHEDULER_CONFIG));
    try {
      this.save(this._cachedConfig);
    } catch {}
    return this._cachedConfig;
  }

  save(newConfig) {
    const merged = this._mergeWithDefaults(newConfig);
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${this.configPath}.tmp.${Date.now()}`;
    const payload = JSON.stringify(merged, null, 2) + "\n";
    fs.writeFileSync(tmpPath, payload, "utf-8");
    fs.renameSync(tmpPath, this.configPath);
    this._cachedConfig = merged;
    return this._cachedConfig;
  }

  getJobConfig(jobId) {
    const config = this._cachedConfig || this.load();
    if (!config.jobs?.[jobId]) return null;
    const { _touched, ...publicConfig } = config.jobs[jobId];
    return publicConfig;
  }

  /**
   * Whether this job's config was ever explicitly saved through the Job
   * Scheduler panel (as opposed to cloned from the example defaults).
   * Only touched jobs are re-applied to live services on gateway boot,
   * so out-of-the-box behaviour of underlying modules is never altered
   * by the mere existence of scheduler.config.json.
   */
  isJobTouched(jobId) {
    const config = this._cachedConfig || this.load();
    return config.jobs?.[jobId]?._touched === true;
  }

  updateJobConfig(jobId, patch) {
    const config = this._cachedConfig || this.load();
    const current = config.jobs?.[jobId] || {};
    const { _touched: _ignored, ...cleanPatch } = patch || {};
    const updatedJob = {
      ...current,
      ...cleanPatch,
      _touched: true,
    };

    const updatedConfig = {
      ...config,
      jobs: {
        ...config.jobs,
        [jobId]: updatedJob,
      },
    };

    this.save(updatedConfig);
    return updatedJob;
  }

  _mergeWithDefaults(userConfig) {
    const base = JSON.parse(JSON.stringify(DEFAULT_SCHEDULER_CONFIG));
    if (!userConfig || typeof userConfig !== "object") return base;

    const merged = {
      version: typeof userConfig.version === "number" ? userConfig.version : base.version,
      jobs: { ...base.jobs },
    };

    if (userConfig.jobs && typeof userConfig.jobs === "object") {
      for (const [id, jobConf] of Object.entries(userConfig.jobs)) {
        if (jobConf && typeof jobConf === "object") {
          const { _touched, ...rest } = jobConf;
          merged.jobs[id] = {
            ...(base.jobs[id] || {}),
            ...rest,
            ...(_touched === true ? { _touched: true } : {}),
          };
        }
      }
    }

    return merged;
  }
}
