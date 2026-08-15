export class CommandAppsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CommandAppsError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const COMMAND_APPS_ERROR_STATUS = {
  invalid_request: 400,
  app_not_found: 404,
  unsupported_platform: 501,
  executable_not_found: 400,
  process_error: 500,
  storage_error: 500,
};
