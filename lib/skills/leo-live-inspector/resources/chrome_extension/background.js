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

chrome.debugger.onEvent.addListener((source, method, params) => {
  cdpSession.handleNetworkEvent(source, method, params);
});

chrome.debugger.onDetach.addListener((source) => {
  cdpSession.handleDetach(source).catch(() => undefined);
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
  for (const url of urls) {
    await heartbeatTarget(url, { id: chrome.runtime.id, task: currentTaskSummary() });
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
    });
  } catch {}
}

const commandQueue = createCommandQueue({
  execute: (task) => executeTask(task),
  report: (url, taskId, envelope) => reportResult(url, taskId, envelope),
});

async function executeDocumentTargetTask(type, params = {}) {
  const tabId = await requireTaskTabId(params);
  const target = type === "dom.state" ? null : normalizeTarget(params);
  const fillValue = type === "dom.fill" ? String(params.value ?? "") : null;
  const res = await chrome.scripting.executeScript({
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
          const clickRes = interaction.clickTarget(document, registry, normalizedTarget);
          let point = null;
          try {
            const el = registry.refs.get(clickRes.ref)?.weak?.deref?.() || null;
            if (el) {
              const rect = el.getBoundingClientRect();
              point = {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
              };
            }
          } catch {}
          return { ...clickRes, _point: point };
        }
        return interaction.fillTarget(document, registry, normalizedTarget, value);
      } catch (err) {
        if (mode === "click") {
          let el = null;
          if (normalizedTarget?.kind === "css" && normalizedTarget.selector) {
            el = document.querySelector(normalizedTarget.selector);
          } else if (rawParams?.selector || rawParams?.sel) {
            el = document.querySelector(rawParams.selector || rawParams.sel);
          } else {
            const txt = (normalizedTarget?.text || rawParams?.text || "").trim().toLowerCase();
            if (txt) {
              const candidates = Array.from(document.querySelectorAll("a, button, input[type='button'], input[type='submit'], [role='button'], [role='tab'], [role='menuitem'], [onclick], div, span, p"));
              el = candidates.find(c => {
                const visible = c.offsetWidth > 0 || c.offsetHeight > 0 || c.getClientRects().length > 0;
                if (!visible) return false;
                const directText = (c.innerText || c.textContent || "").trim().toLowerCase();
                const title = (c.getAttribute("title") || "").toLowerCase();
                const aria = (c.getAttribute("aria-label") || "").toLowerCase();
                return directText.includes(txt) || title.includes(txt) || aria.includes(txt);
              });
            }
          }
          if (el) {
            el.scrollIntoView({ block: "center", inline: "center" });
            const rect = el.getBoundingClientRect();
            const point = {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            };
            try {
              if (typeof PointerEvent === "function") {
                el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0 }));
              }
            } catch {}
            try {
              el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0 }));
            } catch {}
            try { el.focus?.(); } catch {}
            try {
              if (typeof PointerEvent === "function") {
                el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0 }));
              }
            } catch {}
            try {
              el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0 }));
            } catch {}
            try { el.click(); } catch {}
            return {
              clicked: true,
              target: normalizedTarget || { kind: "css", selector: rawParams?.selector || rawParams?.sel },
              matches_n: 1,
              match_level: "located",
              _point: point,
            };
          }
          const targetStr = normalizedTarget?.selector || normalizedTarget?.text || rawParams?.text || rawParams?.selector || JSON.stringify(normalizedTarget || rawParams);
          return {
            ok: false,
            error: `Element not found for click: ${targetStr}`,
            code: normalizedTarget?.kind === "css" ? "selector_not_found" : "semantic_not_found",
          };
        }

        if (mode === "fill") {
          let el = null;
          if (normalizedTarget?.kind === "css" && normalizedTarget.selector) {
            el = document.querySelector(normalizedTarget.selector);
          } else if (rawParams?.selector || rawParams?.sel) {
            el = document.querySelector(rawParams.selector || rawParams.sel);
          }
          if (el) {
            el.focus?.();
            const tag = el.tagName.toLowerCase();
            const editable = el.getAttribute?.("contenteditable") === "true";
            const nextValue = String(value ?? "");
            if (editable) {
              el.textContent = nextValue;
            } else {
              try {
                const proto = tag === "textarea" ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
                const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
                if (setter) setter.call(el, nextValue);
                else el.value = nextValue;
              } catch {
                el.value = nextValue;
              }
            }
            try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
            try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
            return {
              filled: true,
              verified: true,
              actual: nextValue,
              target: normalizedTarget,
              matches_n: 1,
              match_level: "located",
            };
          }
          return {
            ok: false,
            error: `Element not found for fill: ${rawParams?.selector || JSON.stringify(normalizedTarget)}`,
            code: "selector_not_found",
          };
        }

        return { ok: false, error: String(err?.message || err), code: err?.code || "target_error" };
      }
    },
    args: [
      type === "dom.state" ? "state" : type === "dom.find" ? "find" : type === "dom.click" ? "click" : "fill",
      target,
      fillValue,
      params,
    ],
  });

  const result = res?.[0]?.result;
  if (!result) {
    throw lanternError("target_error", "No execution result from tab");
  }
  if (result.ok === false || result.error) {
    throw lanternError(result.code || "target_error", result.error || "Action failed");
  }
  if (result instanceof Error) throw result;

  // Dispatch trusted CDP Input events when point is available
  if (type === "dom.click" && result._point && result._point.x != null && result._point.y != null) {
    const pt = result._point;
    delete result._point;
    let attachedHere = false;
    try {
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
        attachedHere = true;
      } catch (e) {
        // Debugger may already be attached
      }
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: pt.x,
        y: pt.y,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: pt.x,
        y: pt.y,
        button: "left",
        clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: pt.x,
        y: pt.y,
        button: "left",
        clickCount: 1,
      });
    } catch (cdpErr) {
      // CDP fallback already ran
    } finally {
      if (attachedHere && (!taskState?.activeTask?.extensions?.network || taskState.activeTask.extensions.network.tabId !== tabId)) {
        try { await chrome.debugger.detach({ tabId }); } catch {}
      }
    }
  } else if (result._point) {
    delete result._point;
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
      const sameWindow = params.sameWindow !== undefined ? Boolean(params.sameWindow) : true;
      const focus = Boolean(params.focus);
      const color = pickTaskColor(params.color);
      const title = params.title || (taskState.activeTask?.title) || "Agent Task";
      const wasReused = shouldReuseActiveTask(taskState);
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
        const windowId = await ensureTaskWindow({ sameWindow, focus });
        let claimedTabId = params.tabId ? Number(params.tabId) : null;
        if (!claimedTabId) {
          try {
            const activeTabs = await chrome.tabs.query({ windowId, active: true });
            if (activeTabs.length && activeTabs[0].id) {
              claimedTabId = activeTabs[0].id;
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
      result = await withTaskSummary({ started: true, reused: wasReused });
    } else if (type === "task.end") {
      assertActiveTask(taskState);
      const closeGroup = Boolean(params.closeGroup);
      const networkSession = getNetworkSession();
      if (shouldStopNetworkCapture(networkSession)) {
        await cdpSession.stop({ tabId: networkSession.tabId });
      }
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
    } else if (type === "dom.state" || type === "dom.find") {
      result = await executeDocumentTargetTask(type, params);
    } else if (type === "dom.snapshot") {
      const tabId = await requireTaskTabId(params);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const items = [];
          const query = "a, button, input, textarea, select, [role='button'], [role='tab'], [role='menuitem'], [role='link'], h1, h2, h3, [data-testid]";
          const els = Array.from(document.querySelectorAll(query)).slice(0, 150);
          let ref = 1;
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
            if (!visible) continue;

            const text = (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 80);

            let selector = "";
            if (el.id) {
              selector = `#${CSS.escape(el.id)}`;
            } else if (el.getAttribute("data-testid")) {
              selector = `[data-testid="${CSS.escape(el.getAttribute("data-testid"))}"]`;
            } else if (el.name) {
              selector = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
            } else if (el.className && typeof el.className === "string") {
              const classes = el.className.trim().split(/\s+/).filter(c => !c.includes(":") && !c.includes("[")).slice(0, 2);
              if (classes.length) {
                selector = `${el.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join(".")}`;
              }
            }
            if (!selector) {
              selector = el.tagName.toLowerCase();
            }

            const item = {
              ref: ref++,
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role") || (el.tagName === "BUTTON" ? "button" : el.tagName === "A" ? "link" : undefined),
              text: text || undefined,
              selector,
              visible: true,
              disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
              rect: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            };
            if (el.id) item.id = el.id;
            if (el.type) item.type = el.type;
            if (el.name) item.name = el.name;
            if (el.getAttribute("data-testid")) item.testId = el.getAttribute("data-testid");
            items.push(item);
          }
          return { title: document.title, url: location.href, elements: items };
        },
      });
      result = res[0]?.result || {};
    } else if (type === "page.eval") {
      const tabId = await requireTaskTabId(params);
      const script = params.script;
      if (!script) throw lanternError("invalid_request", "Missing script parameter for eval");

      let evalResult = null;
      let evalError = null;
      let evaluated = false;

      // 1. Try CDP Runtime.evaluate first (handles expressions, async promises, and bypasses page CSP)
      let attachedHere = false;
      try {
        try {
          await chrome.debugger.attach({ tabId }, "1.3");
          attachedHere = true;
        } catch {}
        const cdpRes = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
          expression: script,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        });
        if (cdpRes?.exceptionDetails) {
          evalError = cdpRes.exceptionDetails.exception?.description || cdpRes.exceptionDetails.text;
          evaluated = true;
        } else if (cdpRes?.result) {
          evalResult = cdpRes.result.value !== undefined ? cdpRes.result.value : cdpRes.result.description;
          evaluated = true;
        }
      } catch (cdpErr) {
        // Fallback to executeScript below
      } finally {
        if (attachedHere && (!taskState?.activeTask?.extensions?.network || taskState.activeTask.extensions.network.tabId !== tabId)) {
          try { await chrome.debugger.detach({ tabId }); } catch {}
        }
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
      const networkSession = getNetworkSession();
      const alreadyAttached = networkSession?.tabId === tabId && networkSession?.stoppedAt == null;
      if (!alreadyAttached) {
        await chrome.debugger.attach({ tabId }, "1.3");
      }
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
        if (!alreadyAttached) {
          try {
            await chrome.debugger.detach({ tabId });
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
