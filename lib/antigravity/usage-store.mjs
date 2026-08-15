let latest = null;

export function recordAntigravityUsage(response = {}) {
  const remaining = Number(response.remainingCredits);
  const consumed = Number(response.consumedCredits);
  if (!Number.isFinite(remaining) && !Number.isFinite(consumed)) return getAntigravityUsage();
  latest = {
    available: true,
    remaining_credits: Number.isFinite(remaining) ? remaining : null,
    consumed_credits: Number.isFinite(consumed) ? consumed : null,
    updated_at: new Date().toISOString(),
    error: null,
  };
  return latest;
}

export function hasAntigravityUsage() {
  return latest !== null;
}

export function getAntigravityUsage() {
  if (!latest) {
    return {
      available: false,
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
