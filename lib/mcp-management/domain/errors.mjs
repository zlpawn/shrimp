export class McpManagementError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "McpManagementError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const MCP_MANAGEMENT_ERROR_STATUS = {
  invalid_request: 400,
  client_not_found: 404,
  server_not_found: 404,
  storage_error: 500,
};

