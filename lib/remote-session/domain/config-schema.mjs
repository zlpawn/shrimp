// Pure config validation for Remote Session.

import { RemoteSessionError } from "./errors.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function defaultRemoteSessionConfig() {
  return {
    enabled: false,
  };
}

export function normalizeRemoteSessionConfig(input = {}) {
  const src = isObject(input) ? input : {};
  return {
    enabled: asBool(src.enabled, false),
  };
}

export function validateRemoteSessionConfig(
  input = {},
  { natTraversalEnabled = false } = {},
) {
  const cfg = normalizeRemoteSessionConfig(input);
  if (cfg.enabled && !natTraversalEnabled) {
    throw new RemoteSessionError(
      "dependency_disabled",
      "remoteSession.enabled requires natTraversal.enabled = true",
    );
  }
  return cfg;
}

export function publicRemoteSessionConfigView(config = {}) {
  return normalizeRemoteSessionConfig(config);
}
