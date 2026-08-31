export function lanternError(code, message, candidates) {
  const payload = {
    code: String(code || "invalid_request"),
    message: String(message || "Lantern command failed"),
    ...(candidates !== undefined ? { candidates } : {}),
  };
  const error = new Error(payload.message);
  error.code = payload.code;
  error.lanternError = payload;
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
      ...(error.candidates !== undefined ? { candidates: error.candidates } : {}),
    };
  }
  return {
    code: fallbackCode,
    message: typeof error === "string" ? error : String(error?.message || "Lantern command failed"),
  };
}
