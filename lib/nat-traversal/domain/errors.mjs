// Domain errors for NAT Traversal.

export class NatTraversalError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "NatTraversalError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const NAT_TRAVERSAL_ERROR_STATUS = {
  invalid_request: 400,
  invalid_config: 400,
  not_enabled: 409,
  provider_not_found: 404,
  peer_not_found: 404,
  process_error: 500,
  not_running: 409,
  already_running: 409,
  link_failed: 502,
  dashboard_unavailable: 502,
  dashboard_unauthorized: 401,
  storage_error: 500,
  unsupported_feature: 501,
};
