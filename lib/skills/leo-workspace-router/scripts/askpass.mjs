#!/usr/bin/env node
/**
 * SSH_ASKPASS Bridge Script
 * Executed non-interactively by OpenSSH when password authentication is required.
 * Returns the password to stdout for the targeted host.
 */
import { getHost, loadConfig } from "./config.mjs";

function resolvePassword() {
  // 1. Direct process-isolated password injection (fastest and most specific)
  if (process.env.LEO_SSH_PASSWORD) {
    return process.env.LEO_SSH_PASSWORD;
  }

  // 2. Specific host alias injection
  const alias = process.env.LEO_SSH_TARGET_ALIAS;
  if (alias) {
    const h = getHost(alias);
    if (h && h.password) return h.password;
  }

  // 3. Fallback: match from SSH prompt string (e.g. "pa@39.105.19.237's password:")
  const prompt = process.argv[2] || "";
  const cfg = loadConfig();
  for (const h of Object.values(cfg.hosts || {})) {
    if (h.password) {
      if (prompt.includes(h.host) || prompt.includes(h.username)) {
        return h.password;
      }
    }
  }

  return "";
}

const pwd = resolvePassword();
if (pwd) {
  process.stdout.write(pwd);
} else {
  // If no password found, exit cleanly so SSH continues normal flow
  process.exit(1);
}
