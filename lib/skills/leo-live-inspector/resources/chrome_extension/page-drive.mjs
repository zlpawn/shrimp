export function assertWaitParams(params = {}) {
  const text = params.text ? String(params.text) : "";
  const selector = params.selector ? String(params.selector) : "";
  if (!text && !selector) {
    throw new Error("dom.wait requires text or selector");
  }
  const timeoutMs = Number(params.timeoutMs ?? 20000);
  return {
    text,
    selector,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000,
  };
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
