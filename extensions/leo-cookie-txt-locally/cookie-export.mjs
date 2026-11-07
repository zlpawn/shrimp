import { lanternError } from "./errors.mjs";

const DEFAULT_VISIT_TIMEOUT_MS = 15_000;
const LOGIN_HOST = /(^|[.-])(login|logon|signin|sso|passport|cas|auth|accounts)([.-]|$)/i;
const LOGIN_PATH = /\/(log[-_]?in|log[-_]?on|sign[-_]?in|sso|passport|cas|oauth2?|auth|authwall)(\/|\.|$)/i;

/**
 * Reading by url includes cookies set on a parent domain; reading by domain does not.
 * matchedBy tells callers that needed the url form that this extension version honoured it.
 */
export async function exportCookies(chromeApi, params = {}) {
  const details = params.url ? { url: params.url } : { domain: params.domain || "" };
  const cookies = await chromeApi.cookies.getAll(details);
  return { cookies, count: cookies.length, ...(params.url ? { matchedBy: "url" } : {}) };
}

export function looksLikeLoginUrl(url) {
  try {
    const { hostname, pathname, hash } = new URL(url);
    return LOGIN_HOST.test(hostname) || LOGIN_PATH.test(pathname) || LOGIN_PATH.test(hash);
  } catch {
    return false;
  }
}

async function hasVisiblePasswordField(chromeApi, tabId) {
  try {
    const [injection] = await chromeApi.scripting.executeScript({
      target: { tabId },
      func: () => [...document.querySelectorAll('input[type="password"]')].some((el) => el.offsetParent !== null),
    });
    return Boolean(injection?.result);
  } catch {
    return false;
  }
}

/** Waits until the page has finished loading and stopped redirecting. */
async function waitForPageToSettle(chromeApi, tabId, { timeoutMs, settleMs, pollMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = null;
  let stableSince = Date.now();
  let tab = await chromeApi.tabs.get(tabId);
  while (Date.now() < deadline) {
    const url = tab.pendingUrl || tab.url;
    if (tab.status !== "complete" || url !== lastUrl) {
      lastUrl = url;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= settleMs) {
      return { tab, settled: true };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    tab = await chromeApi.tabs.get(tabId);
  }
  return { tab, settled: false };
}

/**
 * Opens a page in its own background window so the site can set or renew its cookies, reads them,
 * and always closes the window. It stays out of the task system, so it cannot touch a running task.
 */
export async function visitForCookies(chromeApi, params = {}, { settleMs = 1500, pollMs = 200 } = {}) {
  if (!/^https?:\/\//i.test(String(params.url))) {
    throw lanternError("invalid_request", "cookies.visit needs an http(s) url");
  }
  const timeoutMs = Number(params.timeoutMs) || DEFAULT_VISIT_TIMEOUT_MS;
  const win = await chromeApi.windows.create({ url: params.url, focused: false, type: "normal" });
  try {
    const tabId = win.tabs[0].id;
    const { tab, settled } = await waitForPageToSettle(chromeApi, tabId, { timeoutMs, settleMs, pollMs });
    const loginRequired = looksLikeLoginUrl(tab.url) || (await hasVisiblePasswordField(chromeApi, tabId));
    const cookies = await chromeApi.cookies.getAll({ url: params.cookieUrl || params.url });
    const final = new URL(tab.url);
    return {
      cookies,
      count: cookies.length,
      matchedBy: "url",
      finalUrl: `${final.origin}${final.pathname}`, // A login redirect's query can carry tickets.
      loginRequired,
      settled,
    };
  } finally {
    await chromeApi.windows.remove(win.id).catch(() => {});
  }
}
