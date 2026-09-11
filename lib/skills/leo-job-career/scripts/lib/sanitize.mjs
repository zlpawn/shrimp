export function redactCookieString(cookieStr) {
  if (!cookieStr || typeof cookieStr !== "string") return "";
  return cookieStr
    .split(";")
    .map((pair) => {
      const trimmed = pair.trim();
      if (!trimmed) return "";
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return `${trimmed}=[REDACTED]`;
      const name = trimmed.slice(0, eqIdx).trim();
      return `${name}=[REDACTED]`;
    })
    .filter(Boolean)
    .join("; ");
}

export function redactHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const redacted = {};
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "cookie") {
      redacted[key] = redactCookieString(val);
    } else if (lower.includes("authorization") || lower.includes("token") || lower.includes("secret")) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = val;
    }
  }
  return redacted;
}

export function redactUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return "";
  try {
    const u = new URL(urlStr);
    const sensitiveParams = ["securityid", "lid", "token", "stoken", "_security_check", "auth"];
    for (const [key] of Array.from(u.searchParams.entries())) {
      if (sensitiveParams.some((p) => key.toLowerCase().includes(p))) {
        u.searchParams.set(key, "[REDACTED]");
      }
    }
    // Return with decoded brackets for clean readability in logs
    return u.toString().replace(/%5BREDACTED%5D/gi, "[REDACTED]");
  } catch {
    return urlStr;
  }
}

export function sanitizeRecord(record) {
  if (!record || typeof record !== "object") return record;
  if (Array.isArray(record)) {
    return record.map((item) => sanitizeRecord(item));
  }

  const out = {};
  for (const [k, v] of Object.entries(record)) {
    const lower = k.toLowerCase();
    if (lower === "securityid" || lower === "lid" || lower === "stoken" || lower === "cookie") {
      out[k] = "[REDACTED]";
    } else if (lower === "headers" && v && typeof v === "object") {
      out[k] = redactHeaders(v);
    } else if (typeof v === "object" && v !== null) {
      out[k] = sanitizeRecord(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
