import { createCredentialRelayClient } from "./credential-relay.mjs";
import { createMultiUrlPollLoop } from "./poll-loop.mjs";
import { createCommandQueue } from "./command-queue.mjs";
import { shouldStopNetworkCapture } from "./background-lifecycle.mjs";
import { heartbeatTarget, registerTarget } from "./bridge-sync.mjs";
import {
  assertClaimParams,
  assertActiveTask,
  decideNewTabAction,
  shouldReuseActiveTask,
} from "./task-policy.mjs";
import {
  createEmptyTaskState,
  toBridgeTaskSummary,
  validateTaskState,
  upsertActiveTask,
  clearActiveTask,
} from "./task-state.mjs";
import {
  pickTaskColor,
  listChromeIds,
  ensureTaskWindow,
  ensureTaskGroup,
  moveTabToTaskGroup,
  createOrNavigateTaskTab,
  ensureRecoverableTaskResources,
  resolveChromeTaskTab,
  navigateTaskTab,
  closeTaskTab,
} from "./task-chrome.mjs";
import {
  assertWaitParams,
  contentMatches,
  summarizeContent,
  normalizePressKey,
} from "./page-drive.mjs";
import { createCdpSessionManager } from "./cdp-session.mjs";
import { normalizeTarget } from "./element-target.mjs";
import { lanternError } from "./errors.mjs";
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:19527";
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8788";
const HEARTBEAT_INTERVAL_MS = 25_000;
const POLL_WAIT_MS = 25_000;
const OFFLINE_BACKOFF_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TASK_STATE_KEY = "leoLanternTaskState";
let taskState = createEmptyTaskState();

async function loadTaskState() {
  const stored = await chrome.storage.session.get(TASK_STATE_KEY);
  const raw = stored?.[TASK_STATE_KEY];
  const chromeIds = await listChromeIds();
  taskState = validateTaskState(raw || createEmptyTaskState(), chromeIds);
  await chrome.storage.session.set({ [TASK_STATE_KEY]: taskState });
  return taskState;
}

async function saveTaskState(next) {
  taskState = next;
  await chrome.storage.session.set({ [TASK_STATE_KEY]: taskState });
  return taskState;
}

function currentTaskSummary() {
  return toBridgeTaskSummary(taskState);
}

async function withTaskSummary(result = {}) {
  return {
    ...result,
    task: currentTaskSummary(),
  };
}

async function requireTaskTabId(params = {}) {
  if (taskState?.activeTask) {
    try {
      const task = assertActiveTask(taskState);
      const resolved = await resolveChromeTaskTab({
        task,
        explicitTabId: params.tabId ?? null,
      });
      if (
        resolved.task.windowId !== task.windowId ||
        resolved.task.groupId !== task.groupId ||
        resolved.task.claimedTabId !== task.claimedTabId
      ) {
        await saveTaskState({ ...taskState, activeTask: resolved.task });
      }
      return resolved.tabId;
    } catch (taskErr) {
      if (params.tabId != null) throw taskErr;
      taskState = createEmptyTaskState();
      await saveTaskState(taskState);
    }
  }

  if (params.tabId != null) {
    const tabId = Number(params.tabId);
    if (Number.isFinite(tabId) && tabId > 0) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.id) return tab.id;
      } catch {}
    }
    throw lanternError("tab_not_found", `Tab ${params.tabId} was not found`);
  }

  try {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTabs.length && activeTabs[0].id) {
      return activeTabs[0].id;
    }
    const anyActive = await chrome.tabs.query({ active: true });
    if (anyActive.length && anyActive[0].id) {
      return anyActive[0].id;
    }
  } catch {}

  throw lanternError("no_active_task", "No active task. Run task.start first.");
}

function getNetworkSession() {
  return taskState.activeTask?.extensions?.network || null;
}

async function saveNetworkSession(session) {
  const task = assertActiveTask(taskState);
  await saveTaskState(
    upsertActiveTask(taskState, {
      extensions: {
        ...(task.extensions || {}),
        network: session,
      },
    })
  );
}

const cdpSession = createCdpSessionManager({
  debuggerApi: chrome.debugger,
  validateTab: (tabId) => requireTaskTabId({ tabId }),
  persist: (session) => saveNetworkSession(session),
});

// Persistent CDP debugger session manager (keeps attachment warm across commands)
const attachedDebuggers = new Set();
const debuggerIdleTimers = new Map();
const DEBUGGER_IDLE_TIMEOUT_MS = 60_000;

function touchDebuggerIdle(tabId) {
  const numericTabId = Number(tabId);
  if (debuggerIdleTimers.has(numericTabId)) {
    clearTimeout(debuggerIdleTimers.get(numericTabId));
  }
  const timer = setTimeout(() => {
    debuggerIdleTimers.delete(numericTabId);
    detachDebuggerSafe(numericTabId).catch(() => {});
  }, DEBUGGER_IDLE_TIMEOUT_MS);
  if (typeof timer?.unref === "function") timer.unref();
  debuggerIdleTimers.set(numericTabId, timer);
}

async function ensureDebuggerAttached(tabId) {
  const numericTabId = Number(tabId);
  touchDebuggerIdle(numericTabId);
  if (attachedDebuggers.has(numericTabId)) {
    return true;
  }
  try {
    await withTimeout(chrome.debugger.attach({ tabId: numericTabId }, "1.3"), 2000, "CDP attach timeout");
    attachedDebuggers.add(numericTabId);
    return true;
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("already attached") || msg.includes("Another debugger")) {
      attachedDebuggers.add(numericTabId);
      return true;
    }
    throw err;
  }
}

async function detachDebuggerSafe(tabId) {
  const numericTabId = Number(tabId);
  if (debuggerIdleTimers.has(numericTabId)) {
    clearTimeout(debuggerIdleTimers.get(numericTabId));
    debuggerIdleTimers.delete(numericTabId);
  }
  attachedDebuggers.delete(numericTabId);
  const networkSession = getNetworkSession();
  if (networkSession?.tabId === numericTabId && networkSession?.stoppedAt == null) {
    return;
  }
  try {
    await withTimeout(chrome.debugger.detach({ tabId: numericTabId }), 2000);
  } catch {}
}

async function detachAllDebuggers() {
  for (const timer of debuggerIdleTimers.values()) {
    clearTimeout(timer);
  }
  debuggerIdleTimers.clear();
  const tabs = Array.from(attachedDebuggers);
  attachedDebuggers.clear();
  const networkSession = getNetworkSession();
  await Promise.allSettled(
    tabs
      .filter((tabId) => !(networkSession?.tabId === tabId && networkSession?.stoppedAt == null))
      .map((tabId) => withTimeout(chrome.debugger.detach({ tabId }), 2000).catch(() => {}))
  );
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  cdpSession.handleNetworkEvent(source, method, params);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId != null) {
    const tid = Number(source.tabId);
    attachedDebuggers.delete(tid);
    if (debuggerIdleTimers.has(tid)) {
      clearTimeout(debuggerIdleTimers.get(tid));
      debuggerIdleTimers.delete(tid);
    }
  }
  cdpSession.handleDetach(source).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const tid = Number(tabId);
  attachedDebuggers.delete(tid);
  if (debuggerIdleTimers.has(tid)) {
    clearTimeout(debuggerIdleTimers.get(tid));
    debuggerIdleTimers.delete(tid);
  }
});

async function getTargetUrls() {
  const result = await chrome.storage.local.get(["gatewayUrl", "bridgeUrl"]);
  const bridgeUrl = result.bridgeUrl || DEFAULT_BRIDGE_URL;
  const gatewayUrl = result.gatewayUrl || DEFAULT_GATEWAY_URL;
  const urls = [bridgeUrl];
  if (gatewayUrl && gatewayUrl !== bridgeUrl) {
    urls.push(gatewayUrl);
  }
  return urls;
}

async function getActiveTabId(preferredTabId) {
  if (preferredTabId) return Number(preferredTabId);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0]) return tabs[0].id;
  const anyTabs = await chrome.tabs.query({ active: true });
  if (anyTabs && anyTabs[0]) return anyTabs[0].id;
  const allTabs = await chrome.tabs.query({});
  if (allTabs && allTabs[0]) return allTabs[0].id;
  throw new Error("No browser tabs found");
}

async function registerTo(url) {
  const result = await registerTarget(url, {
    id: chrome.runtime.id,
    name: "Leo cookie.txt Locally",
    version: chrome.runtime.getManifest().version,
    capabilities: ["cookies", "tabs", "dom", "cdp", "tasks"],
    task: currentTaskSummary(),
  });
  return result.online;
}

async function sendHeartbeats() {
  const urls = await getTargetUrls();
  const version = chrome.runtime.getManifest?.()?.version || "1.3.9";
  for (const url of urls) {
    await heartbeatTarget(url, {
      id: chrome.runtime.id,
      name: "Leo cookie.txt Locally",
      version,
      task: currentTaskSummary(),
      lastCommandSuccessAt: commandQueue.getLastCommandSuccessAt?.() || null,
    });
  }
}

async function pollForCommand(url, waitMs, signal) {
  try {
    const pollResp = await fetch(`${url}/ext/poll?waitMs=${waitMs}`, { signal });
    if (pollResp.ok) {
      const data = await pollResp.json();
      return { online: true, cmd: data.cmd || (Array.isArray(data.tasks) ? data.tasks[0] : null) || null };
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
  }

  try {
    const claimResp = await fetch(`${url}/v1/extension-tasks/claim`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        extension_id: chrome.runtime.id,
        capabilities: ["cookies", "tabs", "dom", "cdp", "tasks"],
        limit: 1,
      }),
    });
    if (claimResp.ok) {
      const data = await claimResp.json();
      return { online: true, cmd: data.tasks && data.tasks[0] ? data.tasks[0] : null };
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
  }

  return { online: false, cmd: null };
}

const pollLoop = createMultiUrlPollLoop({
  pollForCommand,
  runTask: (url, cmd) => commandQueue.submit(url, cmd),
  sleep,
  waitMs: POLL_WAIT_MS,
  offlineBackoffMs: OFFLINE_BACKOFF_MS,
});

async function startPollLoop() {
  const urls = await getTargetUrls();
  pollLoop.reconcile(urls);
}

async function reportResult(url, taskId, envelope) {
  const { ok, result, error } = envelope;
  const payload = {
    id: taskId,
    ok,
    result,
    error,
    cookies: result?.cookies || (Array.isArray(result) ? result : undefined),
    extension_id: chrome.runtime.id,
    task: result?.task !== undefined ? result.task : currentTaskSummary(),
  };

  try {
    const resp = await fetch(`${url}/ext/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) return;
  } catch {}

  // Try gateway task complete/fail endpoints
  try {
    const action = ok ? "complete" : "fail";
    await fetch(`${url}/v1/extension-tasks/${encodeURIComponent(taskId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

function withTimeout(promise, ms, message = "Operation timed out") {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(lanternError("command_timeout", message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

const commandQueue = createCommandQueue({
  execute: (task) => executeTask(task),
  report: (url, taskId, envelope) => reportResult(url, taskId, envelope),
  defaultTimeoutMs: 15_000,
});

async function executeDocumentTargetTask(type, params = {}) {
  const tabId = await requireTaskTabId(params);
  const target = type === "dom.state" ? null : normalizeTarget(params);
  const fillValue = type === "dom.fill" ? String(params.value ?? "") : null;
  const res = await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: async (mode, normalizedTarget, value, rawParams) => {
        try {
          const api = await import(chrome.runtime.getURL("/element-target.mjs"));
          const interaction = await import(chrome.runtime.getURL("/interaction.mjs"));
          const registry = api.ensureDocumentRegistry(globalThis);
          if (mode === "state") return api.collectState(document, registry);
          if (mode === "find") return api.findTargetSnapshot(document, registry, normalizedTarget);
          if (mode === "click") {
            const clickRes = interaction.clickTarget(document, registry, normalizedTarget, { deferClick: true });
            let point = null;
            let clickToken = null;
            try {
              const el = registry.refs.get(clickRes.ref)?.weak?.deref?.() || registry.refs.get(clickRes.ref)?.node || null;
              if (el) {
                el.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
                const rect = el.getBoundingClientRect();
                point = {
                  x: Math.round(rect.left + Math.max(1, rect.width / 2)),
                  y: Math.round(rect.top + Math.max(1, rect.height / 2)),
                };
                clickToken = "lantern_clk_" + Math.random().toString(36).slice(2, 10);
                el.setAttribute("data-lantern-click-token", clickToken);
              }
            } catch {}
            return { ...clickRes, _point: point, _clickToken: clickToken };
          }
          return interaction.fillTarget(document, registry, normalizedTarget, value);
        } catch (err) {
          return {
            ok: false,
            clicked: false,
            code: err?.code || (err?.reason === "ambiguous_match" ? "ambiguous_match" : "target_error"),
            reason: err?.reason || (err?.code === "selector_ambiguous" || err?.code === "semantic_ambiguous" ? "ambiguous_match" : undefined),
            matches_n: err?.matches_n,
            error: err?.message || String(err),
          };
        }
      },
      args: [
        type === "dom.state" ? "state" : type === "dom.find" ? "find" : type === "dom.click" ? "click" : "fill",
        target,
        fillValue,
        params,
      ],
    }),
    8000,
    `Target script execution timed out on tab ${tabId}`
  );

  const result = res?.[0]?.result;
  if (!result) {
    throw lanternError("target_error", "No execution result from tab");
  }
  if (result.ok === false || result.error) {
    throw lanternError(result.code || "target_error", result.error || "Action failed", {
      reason: result.reason,
      matches_n: result.matches_n,
      clicked: false,
    });
  }
  if (result instanceof Error) throw result;

  const clickToken = result._clickToken;
  delete result._clickToken;
  const pt = result._point;
  delete result._point;

  // 1. Primary path: Native CDP Input Mouse Event (trusted browser events)
  let cdpSucceeded = false;
  if (type === "dom.click" && pt && pt.x != null && pt.y != null) {
    try {
      await ensureDebuggerAttached(tabId);
      // Directly dispatch mousePressed and mouseReleased at point (x, y)
      // Omit mouseMoved: mousePressed automatically updates the coordinates in Chromium
      await withTimeout(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: pt.x,
          y: pt.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        }),
        2000,
        "CDP mousePressed timeout"
      );
      await sleep(30);
      await withTimeout(
        chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: pt.x,
          y: pt.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        }),
        2000,
        "CDP mouseReleased timeout"
      );
      cdpSucceeded = true;
    } catch (cdpErr) {
      console.warn("[leo-lantern] CDP click dispatch failed, falling back to script dispatch:", cdpErr?.message || cdpErr);
      attachedDebuggers.delete(Number(tabId));
      cdpSucceeded = false;
    }
  }

  // Clean up temporary click token attribute asynchronously (fire-and-forget, non-blocking)
  if (cdpSucceeded && clickToken) {
    chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (token) => {
        const el = document.querySelector(`[data-lantern-click-token="${token}"]`);
        el?.removeAttribute("data-lantern-click-token");
      },
      args: [clickToken],
    }).catch(() => {});
  }

  // 2. Fallback path: Dispatch in world: "MAIN" ONLY if CDP was not executed or failed
  if (type === "dom.click" && clickToken && !cdpSucceeded) {
    try {
      await withTimeout(
        chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (token, point) => {
            const el = document.querySelector(`[data-lantern-click-token="${token}"]`);
            if (!el) return;
            el.removeAttribute("data-lantern-click-token");
            try { el.focus?.(); } catch {}
            const x = point?.x ?? 0;
            const y = point?.y ?? 0;
            const common = {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: x,
              clientY: y,
              screenX: x,
              screenY: y,
            };
            try {
              el.dispatchEvent(new PointerEvent("pointerdown", { ...common, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
            } catch {}
            try {
              el.dispatchEvent(new MouseEvent("mousedown", { ...common, button: 0, buttons: 1 }));
            } catch {}
            try {
              el.dispatchEvent(new PointerEvent("pointerup", { ...common, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
            } catch {}
            try {
              el.dispatchEvent(new MouseEvent("mouseup", { ...common, button: 0, buttons: 0 }));
            } catch {}
            // Exactly ONE click action: use el.click() if available, otherwise new MouseEvent("click")
            if (typeof el.click === "function") {
              try { el.click(); } catch {}
            } else {
              try {
                el.dispatchEvent(new MouseEvent("click", { ...common, button: 0, buttons: 0 }));
              } catch {}
            }
          },
          args: [clickToken, pt],
        }),
        3000,
        "Click event dispatch in page timed out"
      );
    } catch (mainErr) {}
  }

  return result;
}

async function executeTask(task) {
  const type = task.type;
  const params = task.params || task.payload || {};
  let result = null;

    if (type === "cookies.export" || type === "cookies.get") {
      const domain = params.domain || "";
      const cookies = await chrome.cookies.getAll({ domain });
      result = { cookies, count: cookies.length };
    } else if (type === "tabs.list") {
      const tabs = await chrome.tabs.query({});
      result = tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        active: t.active,
        windowId: t.windowId,
      }));
    } else if (type === "task.start") {
      const sameWindow = params.sameWindow !== undefined ? Boolean(params.sameWindow) : false;
      const focus = Boolean(params.focus);
      const color = pickTaskColor(params.color);
      const title = params.title || (taskState.activeTask?.title) || "Agent Task";

      let isTaskValid = false;
      if (taskState?.activeTask?.windowId) {
        try {
          await chrome.windows.get(taskState.activeTask.windowId);
          isTaskValid = true;
        } catch {
          isTaskValid = false;
        }
      }

      const wasReused = shouldReuseActiveTask(taskState) && isTaskValid && !params.forceNew && !params.reset;
      if (wasReused) {
        const patch = {};
        if (params.title) patch.title = params.title;
        if (params.color) patch.color = color;
        const patched = upsertActiveTask(taskState, patch);
        const recovered = await ensureRecoverableTaskResources(
          patched.activeTask,
          { focus },
          chrome
        );
        await saveTaskState({ ...patched, activeTask: recovered });
      } else {
        await saveTaskState(createEmptyTaskState());
        const windowId = await ensureTaskWindow({ sameWindow, focus });
        let claimedTabId = params.tabId ? Number(params.tabId) : null;
        if (!claimedTabId) {
          try {
            if (sameWindow) {
              // In sameWindow mode without explicit tabId, create a fresh tab rather than seizing user's active tab
              const createdTab = await chrome.tabs.create({ windowId, url: "about:blank", active: Boolean(focus) });
              if (createdTab?.id) claimedTabId = createdTab.id;
            } else {
              // In dedicated window mode, find the initial tab created with that window
              const taskTabs = await chrome.tabs.query({ windowId });
              if (taskTabs.length && taskTabs[0].id) {
                claimedTabId = taskTabs[0].id;
              } else {
                const createdTab = await chrome.tabs.create({ windowId, url: "about:blank", active: Boolean(focus) });
                if (createdTab?.id) claimedTabId = createdTab.id;
              }
            }
          } catch {}
        }
        let groupId = null;
        if (claimedTabId && sameWindow) {
          try {
            groupId = await ensureTaskGroup({
              windowId,
              title,
              color,
              tabIds: [claimedTabId],
            });
          } catch {}
        }
        await saveTaskState(
          upsertActiveTask(createEmptyTaskState(), {
            title,
            color,
            sameWindow,
            windowId,
            groupId,
            claimedTabId,
          })
        );
      }
      result = await withTaskSummary({ started: true, reused: wasReused, sameWindow });
    } else if (type === "task.end") {
      const closeGroup = Boolean(params.closeGroup);
      const networkSession = getNetworkSession();
      if (shouldStopNetworkCapture(networkSession)) {
        await cdpSession.stop({ tabId: networkSession.tabId });
      }
      await detachAllDebuggers();
      const groupId = taskState.activeTask?.groupId;
      if (closeGroup && groupId != null) {
        try {
          const tabs = await chrome.tabs.query({ groupId });
          const tabIds = tabs.map((tab) => tab.id).filter((id) => id != null);
          if (tabIds.length) await chrome.tabs.ungroup(tabIds);
        } catch {}
      }
      await saveTaskState(clearActiveTask(taskState));
      result = await withTaskSummary({ ended: true, closedGroup: closeGroup });
    } else if (type === "tabs.claim") {
      assertActiveTask(taskState);
      const { tabId } = assertClaimParams(params);
      const focus = Boolean(params.focus);
      const sameWindow =
        params.sameWindow !== undefined ? Boolean(params.sameWindow) : Boolean(taskState.activeTask.sameWindow);
      const windowId = await ensureTaskWindow({
        sameWindow,
        focus,
        windowId: taskState.activeTask.windowId,
      });
      const moved = await moveTabToTaskGroup({
        tabId,
        groupId: taskState.activeTask.groupId,
        windowId,
        focus,
      });
      let groupId = moved.groupId;
      groupId = await ensureTaskGroup({
        windowId: moved.windowId,
        title: taskState.activeTask.title,
        color: taskState.activeTask.color,
        groupId,
        tabIds: [tabId],
      });
      await saveTaskState(
        upsertActiveTask(taskState, {
          windowId: moved.windowId,
          groupId,
          claimedTabId: tabId,
          sameWindow,
        })
      );
      result = await withTaskSummary({ claimed: true, tabId, groupId, windowId: moved.windowId });
    } else if (type === "tabs.new") {
      const force = params.force === true || params.force === "true" || params.force === "1";
      const focus = Boolean(params.focus);
      const recovered = await ensureRecoverableTaskResources(
        assertActiveTask(taskState),
        { focus },
        chrome
      );
      await saveTaskState({ ...taskState, activeTask: recovered });
      const action = decideNewTabAction({
        hasActiveTask: true,
        hasClaimedTab: recovered.claimedTabId != null,
        force,
      });
      if (action === "reject-no-task") throw new Error("No active task. Run task.start first.");
      const windowId = await ensureTaskWindow({
        sameWindow: Boolean(recovered.sameWindow),
        focus,
        windowId: recovered.windowId,
      });
      const navigated = await createOrNavigateTaskTab({
        url: params.url || "about:blank",
        action,
        claimedTabId: recovered.claimedTabId,
        windowId,
        groupId: recovered.groupId,
        focus,
      });
      const groupId = await ensureTaskGroup({
        windowId: navigated.windowId,
        title: taskState.activeTask.title,
        color: taskState.activeTask.color,
        groupId: navigated.groupId,
        tabIds: [navigated.tabId],
      });
      await saveTaskState(
        upsertActiveTask(taskState, {
          windowId: navigated.windowId,
          groupId,
          claimedTabId:
            action === "create-force" ? taskState.activeTask.claimedTabId : navigated.tabId,
        })
      );
      result = await withTaskSummary({
        id: navigated.tabId,
        url: params.url || "about:blank",
        reused: Boolean(navigated.reused),
        forced: action === "create-force",
      });
    } else if (type === "tabs.goto") {
      const focus = Boolean(params.focus);
      const navigated = await navigateTaskTab({
        task: assertActiveTask(taskState),
        explicitTabId: params.tabId ?? null,
        url: params.url,
        focus,
      });
      await saveTaskState({ ...taskState, activeTask: navigated.task });
      const updated = navigated.tab;
      result = await withTaskSummary({ id: updated.id, url: updated.url, title: updated.title });
    } else if (type === "tabs.close") {
      const closed = await closeTaskTab({
        task: assertActiveTask(taskState),
        explicitTabId: params.tabId ?? null,
      });
      if (closed.tabId != null) {
        await detachDebuggerSafe(closed.tabId);
      }
      await saveTaskState({ ...taskState, activeTask: closed.task });
      result = await withTaskSummary({ closed: true, tabId: closed.tabId });
    } else if (type === "tabs.reload") {
      const tabId = await requireTaskTabId(params);
      await chrome.tabs.reload(tabId, { bypassCache: Boolean(params.bypassCache) });
      result = await withTaskSummary({ reloaded: true, tabId });
    } else if (type === "dom.click") {
      result = await executeDocumentTargetTask(type, params);
    } else if (type === "dom.fill") {
      result = await executeDocumentTargetTask(type, params);
    } else if (type === "dom.state" || type === "dom.find" || type === "dom.snapshot") {
      result = await executeDocumentTargetTask(type === "dom.snapshot" ? "dom.state" : type, params);
    } else if (type === "page.eval") {
      const tabId = await requireTaskTabId(params);
      const script = params.script;
      if (!script) throw lanternError("invalid_request", "Missing script parameter for eval");

      let evalResult = null;
      let evalError = null;
      let evaluated = false;

      // 1. Try CDP Runtime.evaluate first (handles expressions, async promises, and bypasses page CSP)
      try {
        await ensureDebuggerAttached(tabId);
        const cdpRes = await withTimeout(
          chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
            expression: script,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
          }),
          8000,
          "CDP evaluate timeout"
        );
        if (cdpRes?.exceptionDetails) {
          evalError = cdpRes.exceptionDetails.exception?.description || cdpRes.exceptionDetails.text;
          evaluated = true;
        } else if (cdpRes?.result) {
          evalResult = cdpRes.result.value !== undefined ? cdpRes.result.value : cdpRes.result.description;
          evaluated = true;
        }
      } catch (cdpErr) {
        attachedDebuggers.delete(Number(tabId));
        // Fallback to executeScript below
      }

      // 2. Fallback to chrome.scripting.executeScript if CDP was unavailable
      if (!evaluated) {
        try {
          const res = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: (code) => {
              try {
                const fn = new Function("return (" + code + ")");
                return { value: fn() };
              } catch (e1) {
                try {
                  const fn = new Function(code);
                  return { value: fn() };
                } catch (e2) {
                  try {
                    return { value: (0, eval)(code) };
                  } catch (e3) {
                    return { error: e3.message || e2.message || e1.message };
                  }
                }
              }
            },
            args: [script],
          });
          const injection = res?.[0]?.result;
          if (injection?.error) {
            evalError = injection.error;
          } else if (injection) {
            evalResult = injection.value;
          }
        } catch (scriptErr) {
          evalError = scriptErr.message;
        }
      }

      if (evalError) {
        throw lanternError("eval_error", String(evalError));
      }

      result = await withTaskSummary({ evalResult });
    } else if (type === "dom.wait") {
      const tabId = await requireTaskTabId(params);
      const wait = assertWaitParams(params);
      const started = Date.now();
      for (;;) {
        let page = {};
        try {
          const res = await chrome.scripting.executeScript({
            target: { tabId },
            func: (text, selector) => ({
              text: document.body?.innerText || "",
              selectorFound: Boolean(selector && document.querySelector(selector)),
            }),
            args: [wait.text || null, wait.selector || null],
          });
          page = res?.[0]?.result || {};
        } catch {
          // Page might be navigating or loading; ignore transient execution errors
          page = {};
        }
        if (contentMatches({ haystack: page.text, text: wait.text, selectorFound: page.selectorFound })) {
          result = await withTaskSummary({ waited: true, matched: wait.text || wait.selector, tabId });
          break;
        }
        if (Date.now() - started >= wait.timeoutMs) {
          throw new Error(`Timed out after ${wait.timeoutMs}ms waiting for ${wait.text || wait.selector}`);
        }
        await sleep(Math.min(250, Math.max(25, wait.timeoutMs - (Date.now() - started))));
      }
    } else if (type === "dom.content") {
      const tabId = await requireTaskTabId(params);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (maxChars) => ({
          title: document.title,
          url: location.href,
          text: document.body?.innerText?.slice(0, maxChars) || "",
        }),
        args: [Number(params.maxChars || 4000)],
      });
      result = await withTaskSummary(summarizeContent({ ...(res[0]?.result || {}), maxChars: Number(params.maxChars || 4000) }));
    } else if (type === "dom.press") {
      const tabId = await requireTaskTabId(params);
      const key = normalizePressKey(params.key);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (keyName, selector) => {
          const target = selector ? document.querySelector(selector) : document.activeElement || document.body;
          if (!target) return { ok: false, error: `Key target not found: ${selector || "activeElement"}` };
          const common = { key: keyName, bubbles: true, cancelable: true };
          target.dispatchEvent(new KeyboardEvent("keydown", common));
          target.dispatchEvent(new KeyboardEvent("keypress", common));
          target.dispatchEvent(new KeyboardEvent("keyup", common));
          return { ok: true, key: keyName };
        },
        args: [key, params.selector || null],
      });
      if (res?.[0]?.result?.ok === false) throw new Error(res[0].result.error);
      result = await withTaskSummary({ pressed: true, key, selector: params.selector || null });
    } else if (type === "cdp.screenshot") {
      const tabId = await requireTaskTabId(params);
      const fullPage = Boolean(params.fullPage);
      await ensureDebuggerAttached(tabId);
      try {
        await chrome.debugger.sendCommand({ tabId }, "Page.enable");
        if (fullPage) {
          const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
          const width = Math.ceil(metrics.contentSize?.width || metrics.cssContentSize?.width || 0);
          const height = Math.ceil(metrics.contentSize?.height || metrics.cssContentSize?.height || 0);
          if (width && height) {
            await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
              mobile: false,
              width,
              height,
              deviceScaleFactor: 1,
            });
          }
        }
        const shot = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: fullPage,
        });
        result = { data: shot.data, mimeType: "image/png", fullPage };
      } finally {
        if (fullPage) {
          try {
            await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride");
          } catch {}
        }
      }
    } else if (type === "cdp.net-start") {
      const session = await cdpSession.start({ tabId: params.tabId });
      result = await withTaskSummary({ started: true, tabId: session.tabId, entries: 0 });
    } else if (type === "cdp.net-get") {
      result = await withTaskSummary(cdpSession.get({ tabId: params.tabId, grep: params.grep }));
    } else if (type === "cdp.net-stop") {
      result = await withTaskSummary(await cdpSession.stop({ tabId: params.tabId, grep: params.grep }));
    } else {
      throw new Error(`Unsupported task type: ${type}`);
    }

  return result;
}

// Register on load/startup
async function init() {
  await loadTaskState();
  await cdpSession.reconcile(getNetworkSession());
  const urls = await getTargetUrls();
  for (const url of urls) {
    await registerTo(url);
  }
  startPollLoop();
}

// Keep-alive with alarms
createCredentialRelayClient().start().catch(() => undefined);
chrome.alarms.create("bridge_heartbeat", { periodInMinutes: 0.4 });
chrome.alarms.create("bridge_claim", { periodInMinutes: 0.1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bridge_heartbeat") sendHeartbeats();
  if (alarm.name === "bridge_claim" || alarm.name === "bridge_heartbeat") startPollLoop();
});

setInterval(sendHeartbeats, HEARTBEAT_INTERVAL_MS);

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

// Support external messages from gateway page
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "exportCookies") {
    const domain = msg.domain || "";
    const gatewayUrl = (msg.gatewayUrl || DEFAULT_GATEWAY_URL).replace(/\/$/, "");
    chrome.cookies.getAll({ domain }, async (cookies) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (!cookies || cookies.length === 0) {
        sendResponse({ ok: false, error: "未找到该域名的 cookie" });
        return;
      }
      try {
        const resp = await fetch(`${gatewayUrl}/v1/cookies/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain,
            cookies: cookies.map((c) => ({
              domain: c.domain,
              path: c.path,
              name: c.name,
              value: c.value,
              secure: c.secure,
              httponly: c.httpOnly,
              expires: c.expirationDate || 0,
            })),
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          sendResponse({ ok: true, count: data.count, file_path: data.file_path });
        } else {
          sendResponse({ ok: false, error: data.error?.message || "导出失败" });
        }
      } catch {
        sendResponse({ ok: false, error: "无法连接到网关，请检查Shrimp 服务地址" });
      }
    });
    return true;
  }
  return false;
});

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg && (msg.action === "syncGatewayUrl" || msg.type === "SET_GATEWAY_URL")) {
    const gatewayUrl = msg.gatewayUrl || msg.url;
    if (gatewayUrl) {
      chrome.storage.local.set({ gatewayUrl }, () => {
        init();
        sendResponse({ ok: true, gatewayUrl });
      });
      return true;
    }
  }

  if (msg && msg.action === "getCookies") {
    const domain = msg.domain || "";
    chrome.cookies.getAll({ domain }, (cookies) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ cookies });
      }
    });
    return true;
  }

  sendResponse({ error: "unknown action" });
  return false;
});
