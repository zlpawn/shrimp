/**
 * Multi-vendor quota and rate-limit exhaustion detector.
 * Parses stdout/stderr and error objects for known provider error signatures,
 * extracts recovery timestamps or durations, and assigns standard vendor tags.
 */

function parseDateTimeString(str, nowMs = Date.now()) {
  if (!str) return null;
  // Try direct Date.parse
  // Handle formats like "2026-08-03 00:00:00 +0800 CST" -> "2026-08-03T00:00:00+08:00"
  let sanitized = str.replace(/ CST$/, "").trim();
  const direct = Date.parse(sanitized);
  if (Number.isFinite(direct)) return direct;

  // Format: "YYYY-MM-DD HH:mm:ss +0800"
  const fullMatch = sanitized.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\s+([+-]\d{4}))?/);
  if (fullMatch) {
    const [, y, m, d, hh, mm, ss, tz] = fullMatch;
    const tzStr = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z";
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${tzStr}`;
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return parsed;
  }

  // Format: "HH:mm" or "HH:mm AM/PM"
  const timeMatch = sanitized.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (timeMatch) {
    let [, hoursStr, minsStr, ampm] = timeMatch;
    let hours = parseInt(hoursStr, 10);
    const mins = parseInt(minsStr, 10);
    if (ampm) {
      if (ampm.toUpperCase() === "PM" && hours < 12) hours += 12;
      if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
    }
    const target = new Date(nowMs);
    target.setHours(hours, mins, 0, 0);
    if (target.getTime() <= nowMs) {
      // If time has already passed today, assume tomorrow
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  return null;
}

function parseRelativeDuration(str) {
  if (!str) return null;
  let totalMs = 0;
  let matched = false;

  // Matches "X hours Y minutes", "3h 20m", "45 mins", "1800s"
  const hoursMatch = str.match(/(\d+)\s*(?:hours?|h)/i);
  if (hoursMatch) {
    totalMs += parseInt(hoursMatch[1], 10) * 3600 * 1000;
    matched = true;
  }
  const minsMatch = str.match(/(\d+)\s*(?:minutes?|mins?|m(?!s))/i);
  if (minsMatch) {
    totalMs += parseInt(minsMatch[1], 10) * 60 * 1000;
    matched = true;
  }
  const secsMatch = str.match(/(\d+)\s*(?:seconds?|secs?|s)/i);
  if (secsMatch) {
    totalMs += parseInt(secsMatch[1], 10) * 1000;
    matched = true;
  }

  return matched ? totalMs : null;
}

export function detectQuotaExhaustion({
  error = "",
  stdout = "",
  stderr = "",
  now = Date.now(),
} = {}) {
  const text = [
    typeof error === "string" ? error : (error?.message || error?.stack || String(error || "")),
    String(stdout || ""),
    String(stderr || ""),
  ].filter(Boolean).join("\n");

  const nowMs = typeof now === "number" ? now : (typeof now === "function" ? now() : Date.now());

  // 1. Volcengine Ark / Doubao
  if (
    /AccountQuotaExceeded|weekly usage quota|SetRateLimitExceeded|TPMLimitExceeded|RPMLimitExceeded|AccountOverdue|AccountInArrears|volcengine/i.test(text)
    && (/quota|limit|exceeded|overdue|reset|429/i.test(text))
  ) {
    let resumeAtMs = nowMs + 30 * 60 * 1000; // default 30 min backoff
    const resetMatch = text.match(/reset(?:s)? at\s+([^,.\n]+)/i);
    if (resetMatch) {
      const parsed = parseDateTimeString(resetMatch[1].trim(), nowMs);
      if (parsed) resumeAtMs = parsed;
    }
    return {
      isQuotaError: true,
      vendorTag: "volcengine",
      vendorName: "火山引擎",
      resumeAtMs,
      reason: /AccountQuotaExceeded|weekly usage quota/i.test(text) ? "超过周配额或用量限制" : "请求频率超限 (Rate Limit)",
    };
  }

  // 2. Claude (Anthropic)
  if (
    /5-hour limit|message limit|rate_limit_error|rate limit|usage limit/i.test(text)
    && (/claude|anthropic|reset|try again/i.test(text) || /5-hour/i.test(text))
  ) {
    let resumeAtMs = nowMs + 30 * 60 * 1000;
    const durationMatch = text.match(/try again in\s+([^,.\n]+)/i) || text.match(/resets? in\s+([^,.\n]+)/i);
    if (durationMatch) {
      const duration = parseRelativeDuration(durationMatch[1]);
      if (duration) resumeAtMs = nowMs + duration;
    } else {
      const resetMatch = text.match(/reset(?:s)? at\s+([^,.\n]+)/i);
      if (resetMatch) {
        const parsed = parseDateTimeString(resetMatch[1].trim(), nowMs);
        if (parsed) resumeAtMs = parsed;
      }
    }
    return {
      isQuotaError: true,
      vendorTag: "claude",
      vendorName: "Claude",
      resumeAtMs,
      reason: /5-hour/i.test(text) ? "5 小时用量窗口超限" : "消息限额超限 (Rate Limit)",
    };
  }

  // 3. Zhipu GLM
  if (
    /\b(?:1301|1302|1305|1300)\b|调用次数超限|账户余额不足|并发超限|zhipu|bigmodel/i.test(text)
    && (/1301|1302|1305|余额|超限|limit|quota|rate/i.test(text))
  ) {
    const isBalance = /1302|余额不足|欠费/i.test(text);
    return {
      isQuotaError: true,
      vendorTag: "zhipu",
      vendorName: "智谱 AI",
      resumeAtMs: nowMs + (isBalance ? 30 * 60 * 1000 : 15 * 60 * 1000),
      reason: isBalance ? "账户余额不足或已欠费 (1302)" : "API 调用次数或频率超限 (1301/1305)",
    };
  }

  // 4. DeepSeek
  if (
    /Insufficient Balance|余额不足|deepseek/i.test(text)
    && (/Insufficient Balance|余额不足|429|Rate limit|402|Payment Required/i.test(text))
  ) {
    const isBalance = /Insufficient Balance|余额不足|402/i.test(text);
    return {
      isQuotaError: true,
      vendorTag: "deepseek",
      vendorName: "DeepSeek",
      resumeAtMs: nowMs + (isBalance ? 30 * 60 * 1000 : 15 * 60 * 1000),
      reason: isBalance ? "账户余额不足 (402/Insufficient Balance)" : "并发/请求速率超限 (429 Rate Limit)",
    };
  }

  // 5. Grok (xAI)
  if (
    /grok/i.test(text)
    && (/token expired|Rate limit|Daily limit|throttled|429/i.test(text))
  ) {
    const isDaily = /Daily limit/i.test(text);
    return {
      isQuotaError: true,
      vendorTag: "grok",
      vendorName: "Grok",
      resumeAtMs: nowMs + (isDaily ? 2 * 3600 * 1000 : 30 * 60 * 1000),
      reason: /token expired/i.test(text) ? "Session Token 过期或额度中断" : "请求频率或每日用量超限",
    };
  }

  // 6. Antigravity / Gemini gRPC
  if (
    /Resource has been exhausted|ResourceExhausted|status=8/i.test(text)
    || (/antigravity/i.test(text) && /quota|exhausted|429/i.test(text))
  ) {
    return {
      isQuotaError: true,
      vendorTag: "antigravity",
      vendorName: "Antigravity",
      resumeAtMs: nowMs + 30 * 60 * 1000,
      reason: "模型配额耗尽 (Resource has been exhausted)",
    };
  }

  // 7. Codex / OpenAI
  if (
    /usage cap|insufficient_quota|rate_limit_exceeded/i.test(text)
    || (/codex|openai/i.test(text) && (/429|usage limit|rate limit|quota/i.test(text)))
  ) {
    let resumeAtMs = nowMs + 30 * 60 * 1000;
    const resetMatch = text.match(/reset(?:s)? at\s+([^,.\n]+)/i);
    if (resetMatch) {
      const parsed = parseDateTimeString(resetMatch[1].trim(), nowMs);
      if (parsed) resumeAtMs = parsed;
    }
    return {
      isQuotaError: true,
      vendorTag: "codex",
      vendorName: "Codex",
      resumeAtMs,
      reason: "用量上限超限或频率限制 (Usage Cap/Rate Limit)",
    };
  }

  // 8. Generic 429 / Rate Limit
  if (
    /\b429\b|TooManyRequests|Too Many Requests|rate_limit|rate limit reached|quota exceeded/i.test(text)
  ) {
    return {
      isQuotaError: true,
      vendorTag: "generic",
      vendorName: "AI 供应商",
      resumeAtMs: nowMs + 15 * 60 * 1000,
      reason: "触发频率或用量超限 (429 Too Many Requests)",
    };
  }

  return {
    isQuotaError: false,
    vendorTag: "",
    vendorName: "",
    resumeAtMs: 0,
    reason: "",
  };
}
