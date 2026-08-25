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
      const sameWindow = Boolean(params.sameWindow);
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
        await saveTaskState(
          upsertActiveTask(createEmptyTaskState(), {
            title,
            color,
            sameWindow,
            windowId,
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
      const tabId = await requireTaskTabId(params);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, text) => {
          let el = null;
          if (sel) el = document.querySelector(sel);
          if (!el && text) {
            const lower = text.toLowerCase();
            const elements = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button'], span, div, p"));
            el = elements.find((e) => e.innerText && e.innerText.trim().toLowerCase().includes(lower));
          }
          if (!el) return { ok: false, error: `Element not found for click (selector: ${sel}, text: ${text})` };
          el.scrollIntoView({ behavior: "instant", block: "center" });
          el.click();
          return { ok: true, tag: el.tagName.toLowerCase(), text: el.innerText?.slice(0, 100) };
        },
        args: [params.selector || null, params.text || null],
      });
      if (res && res[0]?.result?.ok === false) {
        throw new Error(res[0].result.error);
      }
      result = res[0]?.result || { clicked: true };
    } else if (type === "dom.fill") {
      const tabId = await requireTaskTabId(params);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return { ok: false, error: `Input element not found for selector: ${sel}` };
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, selector: sel, value: val };
        },
        args: [params.selector, String(params.value)],
      });
      if (res && res[0]?.result?.ok === false) {
        throw new Error(res[0].result.error);
      }
      result = res[0]?.result || { filled: true };
    } else if (type === "dom.snapshot") {
      const tabId = await requireTaskTabId(params);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const items = [];
          const query = "a, button, input, textarea, select, [role='button'], h1, h2, h3";
          const els = Array.from(document.querySelectorAll(query)).slice(0, 100);
          for (const el of els) {
            const text = (el.innerText || el.value || el.placeholder || "").trim().slice(0, 80);
            items.push({
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role") || undefined,
              id: el.id || undefined,
              name: el.getAttribute("name") || undefined,
              type: el.getAttribute("type") || undefined,
              text: text || undefined,
            });
          }
          return { title: document.title, url: location.href, elements: items };
        },
      });
      result = res[0]?.result || {};
    } else if (type === "page.eval") {
      const tabId = await requireTaskTabId(params);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (code) => {
          return window.eval(code);
        },
        args: [params.script],
      });
      result = { evalResult: res[0]?.result };
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
