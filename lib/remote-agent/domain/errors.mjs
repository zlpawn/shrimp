export class RemoteAgentError extends Error {
  constructor(type, message, { status = 400, reply = "" } = {}) {
    super(String(message || type || "remote-agent error"));
    this.name = "RemoteAgentError";
    this.type = String(type || "invalid_request");
    this.status = Number(status) || 400;
    this.reply = String(reply || this.message);
  }
}

export function errorStatus(type) {
  switch (String(type || "")) {
    case "unauthorized":
      return 401;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "internal_error":
      return 500;
    default:
      return 400;
  }
}
