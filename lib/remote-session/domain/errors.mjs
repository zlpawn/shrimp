// Domain errors for Remote Session.

export class RemoteSessionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RemoteSessionError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const REMOTE_SESSION_ERROR_STATUS = {
  invalid_request: 400,
  invalid_config: 400,
  dependency_disabled: 409,
  not_enabled: 409,
  not_controller: 403,
  session_not_found: 404,
  peer_not_found: 404,
  invalid_transition: 409,
  host_backend_unavailable: 503,
  host_backend_unsupported: 501,
  unsupported_feature: 501,
  protocol_error: 400,
  storage_error: 500,
};
