import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";

export interface JobRecentRun {
  timestamp: string;
  durationMs: number;
  success: boolean;
  message: string;
  error: string | null;
}

export interface JobSchemaField {
  key: string;
  label: string;
  type: "boolean" | "number" | "text" | "select" | "string_list";
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: any }>;
  help?: string;
}

export interface JobInfo {
  id: string;
  name: string;
  module: string;
  description: string;
  scheduleSummary: string;
  status: "idle" | "running" | "error" | "disabled";
  enabled: boolean;
  lastRunAt: string | null;
  lastDurationMs: number;
  nextRunAt: string | null;
  lastError: string | null;
  lastMessage: string | null;
  config: Record<string, any>;
  schema: JobSchemaField[];
  recentRuns: JobRecentRun[];
}

interface SchedulerState {
  jobs: JobInfo[];
  loading: boolean;
  runningJobIds: Set<string>;
  savingJobIds: Set<string>;
  expandedFormJobIds: Set<string>;
  expandedHistoryJobIds: Set<string>;
  pollTimer: number | null;
}

const state: SchedulerState = {
  jobs: [],
  loading: false,
  runningJobIds: new Set<string>(),
  savingJobIds: new Set<string>(),
  expandedFormJobIds: new Set<string>(),
  expandedHistoryJobIds: new Set<string>(),
  pollTimer: null,
};

function getRoot(): HTMLElement | null {
  return document.getElementById("scheduler-root");
}

async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(endpoint, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  return body as T;
}

export async function loadJobs(silent = false): Promise<void> {
  if (!silent) {
    state.loading = true;
    render();
  }

  try {
    const data = await apiFetch<{ ok: boolean; jobs: JobInfo[] }>("/v1/scheduler/jobs");
    if (data && Array.isArray(data.jobs)) {
      state.jobs = data.jobs;
    }
  } catch (err: any) {
    if (!silent) {
      showToast(`加载定时任务失败: ${err.message}`, "error");
    }
  } finally {
    state.loading = false;
    render();
  }
}

export async function runJob(jobId: string): Promise<void> {
  if (state.runningJobIds.has(jobId)) return;

  state.runningJobIds.add(jobId);
  render();

  try {
    const res = await apiFetch<{ ok: boolean; durationMs: number; message?: string }>(
      `/v1/scheduler/jobs/${encodeURIComponent(jobId)}/run`,
      { method: "POST" }
    );
    showToast(res.message || "任务执行成功", "success");
    await loadJobs(true);
  } catch (err: any) {
    showToast(`执行任务失败: ${err.message}`, "error");
    await loadJobs(true);
  } finally {
    state.runningJobIds.delete(jobId);
    render();
  }
}

export async function saveJobConfig(jobId: string, formElement: HTMLFormElement): Promise<void> {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return;

  const patch: Record<string, any> = {};
  for (const field of job.schema) {
    const input = formElement.elements.namedItem(field.key) as HTMLInputElement | HTMLSelectElement | null;
    if (!input) continue;

    if (field.type === "boolean") {
      patch[field.key] = (input as HTMLInputElement).checked;
    } else if (field.type === "number") {
      patch[field.key] = Number(input.value);
    } else if (field.type === "string_list") {
      patch[field.key] = input.value
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      patch[field.key] = input.value.trim();
    }
  }

  const submitBtn = formElement.querySelector<HTMLButtonElement>('button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.textContent : null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "正在保存...";
  }

  state.savingJobIds.add(jobId);

  try {
    const res = await apiFetch<{ ok: boolean; job: JobInfo }>(
      `/v1/scheduler/jobs/${encodeURIComponent(jobId)}/config`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      }
    );

    showToast("配置保存成功并已热生效", "success");
    // Update local job state
    const index = state.jobs.findIndex((j) => j.id === jobId);
    if (index !== -1 && res.job) {
      state.jobs[index] = res.job;
    }
    state.expandedFormJobIds.delete(jobId);
  } catch (err: any) {
    showToast(`保存配置失败: ${err.message}`, "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      if (originalBtnText) submitBtn.textContent = originalBtnText;
    }
    state.savingJobIds.delete(jobId);
    return;
  } finally {
    state.savingJobIds.delete(jobId);
  }
  render();
}

export function toggleForm(jobId: string): void {
  if (state.expandedFormJobIds.has(jobId)) {
    state.expandedFormJobIds.delete(jobId);
  } else {
    state.expandedFormJobIds.add(jobId);
  }
  render();
}

export function toggleHistory(jobId: string): void {
  if (state.expandedHistoryJobIds.has(jobId)) {
    state.expandedHistoryJobIds.delete(jobId);
  } else {
    state.expandedHistoryJobIds.add(jobId);
  }
  render();
}

// Expose functions globally for inline HTML event handlers
(window as any).__schedulerRunJob = (jobId: string) => runJob(jobId);
(window as any).__schedulerToggleForm = (jobId: string) => toggleForm(jobId);
(window as any).__schedulerToggleHistory = (jobId: string) => toggleHistory(jobId);
(window as any).__schedulerRefresh = () => loadJobs(false);
(window as any).__schedulerSubmitForm = (event: Event, jobId: string) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  saveJobConfig(jobId, form);
};

function formatTime(isoStr: string | null, fallback = "从未执行"): string {
  if (!isoStr) return fallback;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return fallback === "从未执行" ? "无效时间" : fallback;
    const pad = (n: number) => String(n).padStart(2, "0");
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const h = pad(d.getHours());
    const min = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    return `${m}-${day} ${h}:${min}:${s}`;
  } catch {
    return isoStr;
  }
}

function renderFieldInput(field: JobSchemaField, currentValue: any): string {
  const value = currentValue ?? "";

  if (field.type === "boolean") {
    const checked = Boolean(value) ? "checked" : "";
    return `
      <div class="scheduler-form-toggle-row">
        <label class="scheduler-toggle-switch">
          <input type="checkbox" name="${escapeHtml(field.key)}" ${checked} />
          <span class="scheduler-toggle-slider"></span>
        </label>
        <span class="scheduler-toggle-label">${escapeHtml(field.label)}</span>
      </div>
    `;
  }

  if (field.type === "select") {
    const options = (field.options || [])
      .map(
        (opt) =>
          `<option value="${escapeHtml(opt.value)}" ${opt.value === value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`
      )
      .join("");
    return `
      <div class="scheduler-form-field">
        <label class="scheduler-field-label">${escapeHtml(field.label)}</label>
        <select class="scheduler-form-select" name="${escapeHtml(field.key)}">
          ${options}
        </select>
        ${field.help ? `<div class="scheduler-field-help">${escapeHtml(field.help)}</div>` : ""}
      </div>
    `;
  }

  if (field.type === "number") {
    return `
      <div class="scheduler-form-field">
        <label class="scheduler-field-label">${escapeHtml(field.label)}</label>
        <input 
          type="number" 
          class="scheduler-form-input" 
          name="${escapeHtml(field.key)}" 
          value="${escapeHtml(String(value))}" 
          ${field.min !== undefined ? `min="${field.min}"` : ""} 
          ${field.max !== undefined ? `max="${field.max}"` : ""} 
          ${field.step !== undefined ? `step="${field.step}"` : ""} 
        />
        ${field.help ? `<div class="scheduler-field-help">${escapeHtml(field.help)}</div>` : ""}
      </div>
    `;
  }

  const strValue = Array.isArray(value) ? value.join(", ") : String(value);
  return `
    <div class="scheduler-form-field">
      <label class="scheduler-field-label">${escapeHtml(field.label)}</label>
      <input 
        type="text" 
        class="scheduler-form-input" 
        name="${escapeHtml(field.key)}" 
        value="${escapeHtml(strValue)}" 
      />
      ${field.help ? `<div class="scheduler-field-help">${escapeHtml(field.help)}</div>` : ""}
    </div>
  `;
}

function renderJobCard(job: JobInfo): string {
  const isRunning = state.runningJobIds.has(job.id) || job.status === "running";
  const isFormExpanded = state.expandedFormJobIds.has(job.id);
  const isHistoryExpanded = state.expandedHistoryJobIds.has(job.id);
  const isSaving = state.savingJobIds.has(job.id);

  let statusBadgeClass = "status-idle";
  let statusBadgeLabel = "待机中";

  if (!job.enabled) {
    statusBadgeClass = "status-disabled";
    statusBadgeLabel = "已停用";
  } else if (isRunning) {
    statusBadgeClass = "status-running";
    statusBadgeLabel = "运行中...";
  } else if (job.status === "error" || job.lastError) {
    statusBadgeClass = "status-error";
    statusBadgeLabel = "上次失败";
  }

  return `
    <div class="scheduler-card ${!job.enabled ? "disabled" : ""} ${isRunning ? "running" : ""}" id="job-card-${escapeHtml(job.id)}">
      <div class="scheduler-card-header">
        <div class="scheduler-header-left">
          <span class="scheduler-module-badge">${escapeHtml(job.module)}</span>
          <span class="scheduler-status-pill ${statusBadgeClass}">
            <span class="scheduler-status-dot"></span>
            ${statusBadgeLabel}
          </span>
        </div>
        <div class="scheduler-header-schedule" title="调度计划">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          ${escapeHtml(job.scheduleSummary)}
        </div>
      </div>

      <div class="scheduler-card-body">
        <h3 class="scheduler-job-name">${escapeHtml(job.name)}</h3>
        <p class="scheduler-job-desc">${escapeHtml(job.description)}</p>

        <div class="scheduler-meta-box">
          <div class="scheduler-meta-item">
            <span class="scheduler-meta-label">上次执行</span>
            <span class="scheduler-meta-val">
              ${formatTime(job.lastRunAt)}
              ${job.lastDurationMs > 0 ? `<span class="scheduler-meta-duration">(${job.lastDurationMs}ms)</span>` : ""}
            </span>
          </div>
          <div class="scheduler-meta-item">
            <span class="scheduler-meta-label">下次计划</span>
            <span class="scheduler-meta-val">${formatTime(job.nextRunAt, "未计划")}</span>
          </div>
        </div>

        ${
          job.lastMessage || job.lastError
            ? `
          <div class="scheduler-message-banner ${job.lastError ? "is-error" : ""}">
            <span class="scheduler-msg-icon">${job.lastError ? "⚠️" : "ℹ️"}</span>
            <span class="scheduler-msg-text" title="${escapeHtml(job.lastError || job.lastMessage || "")}">
              ${escapeHtml(job.lastError || job.lastMessage || "")}
            </span>
          </div>
        `
            : ""
        }
      </div>

      <div class="scheduler-card-actions">
        <button 
          type="button" 
          class="scheduler-action-btn primary ${isRunning ? "loading" : ""}" 
          ${isRunning ? "disabled" : ""}
          onclick="window.__schedulerRunJob('${escapeHtml(job.id)}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          ${isRunning ? "执行中..." : "立即执行"}
        </button>

        <button 
          type="button" 
          class="scheduler-action-btn ${isFormExpanded ? "active" : ""}" 
          onclick="window.__schedulerToggleForm('${escapeHtml(job.id)}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          ${isFormExpanded ? "收起配置" : "配置"}
        </button>

        ${
          job.recentRuns && job.recentRuns.length > 0
            ? `
          <button 
            type="button" 
            class="scheduler-action-btn ${isHistoryExpanded ? "active" : ""}" 
            onclick="window.__schedulerToggleHistory('${escapeHtml(job.id)}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            历史 (${job.recentRuns.length})
          </button>
        `
            : ""
        }
      </div>

      ${
        isFormExpanded
          ? `
        <form class="scheduler-card-collapsible-form" onsubmit="window.__schedulerSubmitForm(event, '${escapeHtml(job.id)}')">
          <div class="scheduler-form-header">
            <span class="scheduler-form-title">🛠️ 任务参数配置 (scheduler.config.json)</span>
          </div>
          <div class="scheduler-form-body">
            ${job.schema.map((f) => renderFieldInput(f, job.config?.[f.key])).join("")}
          </div>
          <div class="scheduler-form-footer">
            <button type="submit" class="scheduler-btn-save" ${isSaving ? "disabled" : ""}>
              ${isSaving ? "正在保存..." : "保存配置"}
            </button>
            <button type="button" class="scheduler-btn-cancel" onclick="window.__schedulerToggleForm('${escapeHtml(job.id)}')">
              取消
            </button>
          </div>
        </form>
      `
          : ""
      }

      ${
        isHistoryExpanded
          ? `
        <div class="scheduler-card-history-box">
          <div class="scheduler-history-title">最近执行历史 (最新 10 条)</div>
          <div class="scheduler-history-list">
            ${(job.recentRuns || [])
              .map(
                (run) => `
              <div class="scheduler-history-item ${run.success ? "success" : "fail"}">
                <div class="scheduler-history-top">
                  <span class="scheduler-history-tag ${run.success ? "tag-ok" : "tag-err"}">
                    ${run.success ? "成功" : "失败"}
                  </span>
                  <span class="scheduler-history-time">${formatTime(run.timestamp)}</span>
                  <span class="scheduler-history-dur">${run.durationMs}ms</span>
                </div>
                <div class="scheduler-history-msg">${escapeHtml(run.message || run.error || "")}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `
          : ""
      }
    </div>
  `;
}

export function render(): void {
  const root = getRoot();
  if (!root) return;

  const total = state.jobs.length;
  const running = state.jobs.filter((j) => state.runningJobIds.has(j.id) || j.status === "running").length;
  const idle = state.jobs.filter((j) => j.enabled && j.status !== "running" && !state.runningJobIds.has(j.id)).length;
  const disabled = state.jobs.filter((j) => !j.enabled).length;

  root.innerHTML = `
    <div class="scheduler-container">
      <div class="scheduler-top-bar">
        <div class="scheduler-title-group">
          <h2 class="scheduler-main-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            定时任务调度中心
          </h2>
          <div class="scheduler-kpi-badges">
            <span class="scheduler-kpi-pill">全部: <b>${total}</b></span>
            <span class="scheduler-kpi-pill kpi-idle">待机: <b>${idle}</b></span>
            ${running > 0 ? `<span class="scheduler-kpi-pill kpi-running">运行中: <b>${running}</b></span>` : ""}
            ${disabled > 0 ? `<span class="scheduler-kpi-pill kpi-disabled">已停用: <b>${disabled}</b></span>` : ""}
          </div>
        </div>

        <div class="scheduler-top-actions">
          <button type="button" class="scheduler-refresh-btn ${state.loading ? "spinning" : ""}" onclick="window.__schedulerRefresh()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            刷新状态
          </button>
        </div>
      </div>

      ${
        state.loading && state.jobs.length === 0
          ? `
        <div class="scheduler-loading-state">
          <div class="scheduler-spinner"></div>
          <p>正在读取网关定时任务状态...</p>
        </div>
      `
          : `
        <div class="scheduler-grid">
          ${state.jobs.map(renderJobCard).join("")}
        </div>
      `
      }
    </div>
  `;
}

// Register tab navigation hooks
registerTab("scheduler", {
  onEnter: () => {
    loadJobs(false);
    // Poll every 10 seconds for real-time status update while tab is open
    if (!state.pollTimer) {
      state.pollTimer = window.setInterval(() => {
        loadJobs(true);
      }, 10000);
    }
  },
  onLeave: () => {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  },
});
