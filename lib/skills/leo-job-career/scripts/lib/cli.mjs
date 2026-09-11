import os from "node:os";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./config.mjs";

export function formatSuccess(command, data = {}, options = {}) {
  return {
    ok: true,
    command,
    data: data || {},
    warnings: options.warnings || [],
    next_actions: options.next_actions || [],
  };
}

export function formatError(code, message, options = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
    },
    checkpoint_saved: Boolean(options.checkpoint_saved),
    next_actions: options.next_actions || [],
    ...(options.data ? { data: options.data } : {}),
  };
}

export function parseCliArgs(args) {
  let command = null;
  let subcommand = null;
  const positional = [];
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const equalIndex = arg.indexOf("=");
      if (equalIndex !== -1) {
        const key = arg.slice(2, equalIndex);
        const val = arg.slice(equalIndex + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          flags[key] = nextArg;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      if (!command) {
        command = arg;
      } else if (!subcommand) {
        subcommand = arg;
      } else {
        positional.push(arg);
      }
    }
  }

  return { command, subcommand, positional, flags };
}

export function checkClipboardSupport() {
  if (process.platform === "darwin") {
    try {
      execSync("which pbpaste", { stdio: "ignore" });
      return { supported: true, tool: "pbpaste" };
    } catch {
      return { supported: false, tool: "pbpaste", reason: "pbpaste not found" };
    }
  }
  return { supported: false, tool: "none", reason: "clipboard tool only natively probed for macOS pbpaste in Phase 1" };
}

export function executeDoctor(context = {}) {
  const paths = context.paths || resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const clipboard = checkClipboardSupport();
  const authStateExists = fs.existsSync(paths.authStateFile);
  let authSummary = { has_auth: false, status: "missing" };
  if (authStateExists) {
    try {
      const state = JSON.parse(fs.readFileSync(paths.authStateFile, "utf8"));
      authSummary = {
        has_auth: state.status === "valid",
        status: state.status,
        cookie_count: state.cookie_count,
        imported_at: state.imported_at,
        last_verified_at: state.last_verified_at,
      };
    } catch {}
  }

  const data = {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    runtime_root: paths.root,
    directories_ready: true,
    clipboard,
    auth: authSummary,
  };

  const warnings = [];
  const next_actions = [];

  if (!authSummary.has_auth) {
    warnings.push("BOSS Zhipin credentials missing or not verified.");
    next_actions.push("Copy Cookie Header from Leo cookie.txt Locally browser extension, then run: auth import-clipboard");
  } else {
    next_actions.push("Run market init to inspect current Beijing Java + Agent job market.");
  }

  return formatSuccess("doctor", data, { warnings, next_actions });
}
