export class CodexhostIntegrationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "CodexhostIntegrationError";
    this.code = code;
    this.details = details;
  }
}

export const CODEXHOST_ERROR_STATUS = Object.freeze({
  invalid_request: 400,
  confirmation_required: 409,
  desktop_conflict: 409,
  gateway_offline: 503,
  codex_config_invalid: 409,
  executable_not_found: 404,
  runtime_owner_mismatch: 409,
  runtime_not_managed: 409,
  runtime_state_unavailable: 503,
  unsupported_platform: 400,
  process_error: 500,
});
