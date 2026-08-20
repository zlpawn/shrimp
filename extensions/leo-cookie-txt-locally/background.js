const DEFAULT_BRIDGE_URL = "http://127.0.0.1:19527";
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8788";
const HEARTBEAT_INTERVAL_MS = 25_000;
const CLAIM_INTERVAL_MS = 2_000;

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
  try {
    const resp = await fetch(`${url}/ext/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: chrome.runtime.id,
        name: "Leo Browser Bridge",
        version: chrome.runtime.getManifest().version,
        capabilities: ["cookies", "tabs", "dom", "cdp"],
      }),
    });
    if (resp.ok) return true;
  } catch {
    // try fallback gateway register format
    try {
      await fetch(`${url}/v1/extensions/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: chrome.runtime.id,
          name: "Leo Browser Bridge",
          version: chrome.runtime.getManifest().version,
          capabilities: ["cookies", "tabs", "dom", "cdp"],
        }),
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function sendHeartbeats() {
  const urls = await getTargetUrls();
  for (const url of urls) {
    try {
      await fetch(`${url}/ext/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chrome.runtime.id }),
      });
    } catch {
      try {
        await fetch(`${url}/v1/extensions/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: chrome.runtime.id }),
        });
      } catch {}
    }
  }
}

let claimInFlight = false;

async function claimAndExecute() {
  if (claimInFlight) return;
  claimInFlight = true;
  try {
    const urls = await getTargetUrls();
    for (const url of urls) {
      try {
        let task = null;
        // Try bridge poll endpoint first
        const pollResp = await fetch(`${url}/ext/poll?waitMs=1000`);
        if (pollResp.ok) {
          const data = await pollResp.json();
          if (data.cmd) task = data.cmd;
        }

        // Fallback to gateway task claim endpoint if no cmd from poll
        if (!task) {
          const claimResp = await fetch(`${url}/v1/extension-tasks/claim`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              extension_id: chrome.runtime.id,
              capabilities: ["cookies", "tabs", "dom", "cdp"],
              limit: 1,
            }),
          });
          if (claimResp.ok) {
            const data = await claimResp.json();
            if (data.tasks && data.tasks[0]) task = data.tasks[0];
          }
        }

        if (task) {
          await runTask(url, task);
        }
      } catch {
        // silent fallback to next url
      }
    }
  } finally {
    claimInFlight = false;
  }
}

async function reportResult(url, taskId, ok, result, error) {
  const payload = {
    id: taskId,
    ok,
    result,
    error: error ? (typeof error === "string" ? error : error.message) : undefined,
    cookies: result?.cookies || (Array.isArray(result) ? result : undefined),
    extension_id: chrome.runtime.id,
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

async function runTask(url, task) {
  const taskId = task.id;
  const type = task.type;
  const params = task.params || task.payload || {};

  try {
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
    } else if (type === "tabs.new") {
      const created = await chrome.tabs.create({ url: params.url || "about:blank", active: true });
      result = { id: created.id, url: created.url, title: created.title };
    } else if (type === "tabs.goto") {
      const tabId = await getActiveTabId(params.tabId);
      const updated = await chrome.tabs.update(tabId, { url: params.url });
      result = { id: updated.id, url: updated.url, title: updated.title };
    } else if (type === "tabs.close") {
      const tabId = Number(params.tabId);
      await chrome.tabs.remove(tabId);
      result = { closed: true, tabId };
    } else if (type === "dom.click") {
      const tabId = await getActiveTabId(params.tabId);
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
      const tabId = await getActiveTabId(params.tabId);
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
      const tabId = await getActiveTabId(params.tabId);
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
      const tabId = await getActiveTabId(params.tabId);
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: (code) => {
          return window.eval(code);
        },
        args: [params.script],
      });
      result = { evalResult: res[0]?.result };
    } else if (type === "cdp.screenshot") {
      const tabId = await getActiveTabId(params.tabId);
      await chrome.debugger.attach({ tabId }, "1.3");
      try {
        await chrome.debugger.sendCommand({ tabId }, "Page.enable");
        const shot = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
        });
        result = { data: shot.data, mimeType: "image/png" };
      } finally {
        await chrome.debugger.detach({ tabId });
      }
    } else {
      throw new Error(`Unsupported task type: ${type}`);
    }

    await reportResult(url, taskId, true, result, null);
  } catch (err) {
    await reportResult(url, taskId, false, null, err);
  }
}

// Register on load/startup
async function init() {
  const urls = await getTargetUrls();
  for (const url of urls) {
    await registerTo(url);
  }
}

// Keep-alive with alarms
chrome.alarms.create("bridge_heartbeat", { periodInMinutes: 0.4 });
chrome.alarms.create("bridge_claim", { periodInMinutes: 0.1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bridge_heartbeat") sendHeartbeats();
  if (alarm.name === "bridge_claim" || alarm.name === "bridge_heartbeat") claimAndExecute();
});

setInterval(claimAndExecute, CLAIM_INTERVAL_MS);
setInterval(sendHeartbeats, HEARTBEAT_INTERVAL_MS);

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

// Support external messages from gateway page
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
