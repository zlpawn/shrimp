export function lanternError(code, message, metadata) {
  const payload = {
    code: String(code || "invalid_request"),
    message: String(message || "Lantern command failed"),
    ...(metadata && typeof metadata === "object"
      ? metadata
      : metadata !== undefined
      ? { candidates: metadata }
      : {}),
  };
  const error = new Error(payload.message);
  error.code = payload.code;
  error.lanternError = payload;
  if (metadata && typeof metadata === "object") {
    Object.assign(error, metadata);
  }
  return error;
}

export function normalizeLanternError(error, fallbackCode = "invalid_request") {
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
