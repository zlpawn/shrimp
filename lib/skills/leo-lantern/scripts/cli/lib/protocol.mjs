export const DEFAULT_BRIDGE_PORT = 19527;
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_COMMAND_TIMEOUT_MS = 25000;
export const DEFAULT_POLL_TIMEOUT_MS = 25000;
export const DEFAULT_WAIT_TIMEOUT_MS = 30000; // matches assertWaitParams in the extension
export const WAIT_TRANSPORT_ALLOWANCE_MS = 2000;
export const DEFAULT_IDLE_EXIT_MIN = 10;
export const DEFAULT_BRIDGE_START_TIMEOUT_MS = 30000;
export const DEFAULT_VISIT_TIMEOUT_MS = 15000;
export const VISIT_TRANSPORT_ALLOWANCE_MS = 5000;

export class LanternProtocolError extends Error {
  constructor(error = {}, fallbackCode = "invalid_request") {
    const payload = normalizeProtocolError(error, fallbackCode);
    super(payload.message);
    this.name = "LanternProtocolError";
    this.code = payload.code;
    this.lanternError = payload;
  }
}

export function normalizeProtocolError(error, fallbackCode = "invalid_request") {
  if (error?.lanternError?.code && error?.lanternError?.message) {
    return { ...error.lanternError };
  }
  if (error && typeof error === "object" && error.code && error.message) {
    return {
      code: String(error.code),
      message: String(error.message),
      ...(error.reason !== undefined ? { reason: error.reason } : {}),
      ...(error.matches_n !== undefined ? { matches_n: error.matches_n } : {}),
      ...(error.clicked !== undefined ? { clicked: error.clicked } : {}),
      ...(error.candidates !== undefined ? { candidates: error.candidates } : {}),
    };
  }
  return {
    code: fallbackCode,
    message: typeof error === "string" ? error : String(error?.message || "Lantern command failed"),
  };
}

export function protocolError(error, fallbackCode = "invalid_request") {
  return error instanceof LanternProtocolError
    ? error
    : new LanternProtocolError(error, fallbackCode);
}

export function protocolErrorStatus(error) {
  const code = normalizeProtocolError(error).code;
  if (code === "invalid_request") return 400;
  if (code === "command_timeout") return 504;
  if (code === "bridge_unavailable") return 503;
  return 422;
}

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
  DOM_STATE: "dom.state",
  DOM_FIND: "dom.find",
  DOM_SNAPSHOT: "dom.snapshot",
  PAGE_EVAL: "page.eval",
  CDP_SCREENSHOT: "cdp.screenshot",
  COOKIES_EXPORT: "cookies.export",
  COOKIES_VISIT: "cookies.visit",
  TABS_RELOAD: "tabs.reload",
  DOM_WAIT: "dom.wait",
  DOM_CONTENT: "dom.content",
  DOM_PRESS: "dom.press",
  CDP_NET_START: "cdp.net-start",
  CDP_NET_GET: "cdp.net-get",
  CDP_NET_STOP: "cdp.net-stop",
  CDP_UPLOAD: "cdp.upload",
};

// eval() cannot contain await, so compile in the page: as one expression, then with the last
// statement returned, then as plain statements. Only the final form may report a syntax error.
function wrapAwaitWithoutReturn(script) {
  return `(async () => {
  const AsyncFunction = (async () => {}).constructor;
  const source = ${JSON.stringify(script)}.trim().replace(/;+\\s*$/, "");
  const lastSemi = source.lastIndexOf(";");
  const bodies = ["return (" + source + "\\n);"];
  if (lastSemi !== -1) bodies.push(source.slice(0, lastSemi + 1) + "\\nreturn (" + source.slice(lastSemi + 1) + "\\n);");
  bodies.push(source);
  for (const body of bodies) {
    let fn;
    try {
      fn = new AsyncFunction(body);
    } catch (err) {
      if (body === source) throw err;
      continue;
    }
    return await fn();
  }
})()`;
}

export function wrapEvalScript(script) {
  if (!script || typeof script !== "string") return script;
  const trimmed = script.trim();
  if (!trimmed) return script;

  if (
    (trimmed.startsWith("(") && (trimmed.endsWith(")") || trimmed.endsWith(");"))) ||
    trimmed.startsWith("(() =>") ||
    trimmed.startsWith("(async () =>") ||
    trimmed.startsWith("(function")
  ) {
    return script;
  }

  if (/\bawait\b/.test(trimmed)) {
    if (/\breturn\b/.test(trimmed)) {
      return `(async () => {\n${script}\n})()`;
    }
    return wrapAwaitWithoutReturn(script);
  }

  if (/\breturn\b/.test(trimmed)) {
    return `(() => {\n${script}\n})()`;
  }

  return `(() => {\n  return eval(${JSON.stringify(script)});\n})()`;
}
