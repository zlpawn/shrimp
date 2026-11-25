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
    return wrapAwaitWithoutReturn(script);
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

const NAMED_KEY_CODES = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

// Many components still read code/keyCode; a KeyboardEvent carrying only `key` is ignored by them.
export function pressKeyEventInit(key) {
  const named = NAMED_KEY_CODES[key];
  if (named) return { key, code: key, keyCode: named, which: named };
  if (key === " ") return { key, code: "Space", keyCode: 32, which: 32 };
  if (/^[a-zA-Z]$/.test(key)) {
    const upper = key.toUpperCase();
    return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), which: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(key)) {
    return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), which: key.charCodeAt(0) };
  }
  return { key };
}

export function cdpKeyEventParams(key) {
  const named = NAMED_KEY_CODES[key];
  if (named) {
    const code = key === "Enter" ? "Enter" :
                 key === "Escape" ? "Escape" :
                 key === "Tab" ? "Tab" :
                 key === "Backspace" ? "Backspace" :
                 key === "Delete" ? "Delete" :
                 key.startsWith("Arrow") ? key : key;
    return {
      key,
      code,
      keyCode: named,
      windowsVirtualKeyCode: named,
      nativeVirtualKeyCode: named,
      text: key === "Enter" ? "\r" : key === "Tab" ? "\t" : "",
    };
  }
  if (key === " ") {
    return {
      key: " ",
      code: "Space",
      keyCode: 32,
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
      text: " ",
    };
  }
  if (/^[a-zA-Z]$/.test(key)) {
    const upper = key.toUpperCase();
    const codeVal = upper.charCodeAt(0);
    return {
      key,
      code: `Key${upper}`,
      keyCode: codeVal,
      windowsVirtualKeyCode: codeVal,
      nativeVirtualKeyCode: codeVal,
      text: key,
    };
  }
  if (/^[0-9]$/.test(key)) {
    const codeVal = key.charCodeAt(0);
    return {
      key,
      code: `Digit${key}`,
      keyCode: codeVal,
      windowsVirtualKeyCode: codeVal,
      nativeVirtualKeyCode: codeVal,
      text: key,
    };
  }
  return {
    key,
    code: key,
    keyCode: 0,
    windowsVirtualKeyCode: 0,
    nativeVirtualKeyCode: 0,
    text: key.length === 1 ? key : "",
  };
}

// No `ok` field here: the command queue would take this for a whole envelope and drop the value.
export function evalOutcome(value, evaluated) {
  const evalResult = value !== undefined ? value : null;
  return { evalResult, hasResult: evaluated, resultType: evalResult === null ? "null" : typeof evalResult };
}

// A timed-out CDP evaluate may still be running, so injecting it again would repeat its side effects.
export function evalShouldFallback(cdpError) {
  return cdpError?.code !== "command_timeout";
}
