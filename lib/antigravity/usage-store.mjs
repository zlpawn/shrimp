let latest = null;

export function recordAntigravityUsage(response = {}) {
  const remainingPercent = Number(response.remaining_percent);
  const remainingCredits = Number(response.remainingCredits ?? response.remaining_credits);
  const consumed = Number(response.consumedCredits ?? response.consumed_credits);
  if (!Number.isFinite(remainingPercent) && !Number.isFinite(remainingCredits) && !Number.isFinite(consumed)) {
    return getAntigravityUsage();
  }
  latest = {
    available: true,
    remaining_percent: Number.isFinite(remainingPercent) ? remainingPercent : null,
    remaining_credits: Number.isFinite(remainingCredits) ? remainingCredits : null,
    consumed_credits: Number.isFinite(consumed) ? consumed : null,
    reset_hint: response.reset_hint || response.description || "",
    updated_at: new Date().toISOString(),
    error: null,
  };
  return latest;
}

export function resetAntigravityUsageForTests() {
  latest = null;
}

export function hasAntigravityUsage() {
  return latest !== null;
}

export function getAntigravityUsage() {
  if (!latest) {
    return {
    available: false,
    remaining_percent: null,
      remaining_credits: null,
      consumed_credits: null,
      updated_at: null,
      error: {
        code: "antigravity_usage_unavailable",
        message: "尚未捕获 Antigravity 响应中的剩余额度，完成一次模型调用后自动更新。",
      },
    };
  }
  return latest;
}
