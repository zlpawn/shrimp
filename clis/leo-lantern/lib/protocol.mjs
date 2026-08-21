export const DEFAULT_BRIDGE_PORT = 19527;
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_COMMAND_TIMEOUT_MS = 25000;
export const DEFAULT_POLL_TIMEOUT_MS = 25000;

export const COMMAND_TYPES = {
  HEALTH: "health",
  DOCTOR: "doctor",
  TABS_LIST: "tabs.list",
  TABS_NEW: "tabs.new",
  TABS_GOTO: "tabs.goto",
  TABS_CLOSE: "tabs.close",
  TABS_CLAIM: "tabs.claim",
  TASK_START: "task.start",
  TASK_END: "task.end",
  DOM_CLICK: "dom.click",
  DOM_FILL: "dom.fill",
  DOM_SNAPSHOT: "dom.snapshot",
  PAGE_EVAL: "page.eval",
  CDP_SCREENSHOT: "cdp.screenshot",
  COOKIES_EXPORT: "cookies.export",
  TABS_RELOAD: "tabs.reload",
};
