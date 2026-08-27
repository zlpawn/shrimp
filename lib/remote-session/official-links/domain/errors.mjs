export class OfficialRemoteLinkError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OfficialRemoteLinkError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const OFFICIAL_REMOTE_LINK_ERROR_STATUS = {
  invalid_request: 400,
  link_not_found: 404,
  frame_check_failed: 502,
  storage_error: 500,
};
