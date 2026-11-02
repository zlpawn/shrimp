export function assertWaitParams(params = {}) {
  const text = params.text ? String(params.text) : "";
  const selector = params.selector ? String(params.selector) : "";
  const idle = Boolean(params.idle || params.stable || params.idleMs || params.stableMs);
  const idleMs = Number(params.idleMs || params.stableMs || (idle ? 2000 : 0));
  if (!text && !selector && !idle) {
    throw new Error("dom.wait requires text or selector (or idle/stable mode)");
  }
  const timeoutMs = Number(params.timeoutMs ?? 30000);
  return {
    text,
    selector,
    idle,
    idleMs: idleMs > 0 ? idleMs : 2000,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
  };
}

export function wrapEvalScript(script) {
  if (!script || typeof script !== "string") return script;
  const trimmed = script.trim();
  if (!trimmed) return script;

  // Already an IIFE or parenthesized block
  if (
    (trimmed.startsWith("(") && (trimmed.endsWith(")") || trimmed.endsWith(");"))) ||
    trimmed.startsWith("(() =>") ||
    trimmed.startsWith("(async () =>") ||
    trimmed.startsWith("(function")
  ) {
    return script;
  }

  // Top-level await
  if (/\bawait\b/.test(trimmed)) {
    if (/\breturn\b/.test(trimmed)) {
      return `(async () => {\n${script}\n})()`;
    }
    return `(async () => {\n  return eval(${JSON.stringify(script)});\n})()`;
  }

  // Explicit return
  if (/\breturn\b/.test(trimmed)) {
    return `(() => {\n${script}\n})()`;
  }

  // Evaluate in local IIFE scope to prevent top-level const/let/var collision in page global context
  // while preserving expression return value
  return `(() => {\n  return eval(${JSON.stringify(script)});\n})()`;
}

export function contentMatches({ haystack, text = "", selectorFound = false }) {
  if (text) {
    return String(haystack || "").toLowerCase().includes(String(text).toLowerCase());
  }
  return Boolean(selectorFound);
}

export function summarizeContent({ title = "", url = "", text = "", maxChars = 4000 } = {}) {
  const clipped = String(text || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
  return { title, url, text: clipped };
}

export function normalizePressKey(key) {
  const value = String(key || "").trim();
  if (!value) throw new Error("dom.press requires key");
  return value;
}
