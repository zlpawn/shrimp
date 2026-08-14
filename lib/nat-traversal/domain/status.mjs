// Process / link status enums.

export const PROVIDER_STATUS = Object.freeze({
  stopped: "stopped",
  starting: "starting",
  running: "running",
  error: "error",
});

export const LINK_STATUS = Object.freeze({
  unknown: "unknown",
  online: "online",
  offline: "offline",
  error: "error",
});
