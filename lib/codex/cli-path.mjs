import fs from "node:fs";
import path from "node:path";

export function resolveCodexCliPath({
  env = process.env,
  platform = process.platform,
  fsApi = fs,
} = {}) {
  const configured = String(env.CODEX_CLI_PATH || "").trim();
  if (configured) return configured;

  if (platform !== "win32") return "codex";

  const localAppData = String(env.LOCALAPPDATA || "").trim();
  if (!localAppData) return "codex";

  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  let entries;
  try {
    entries = fsApi.readdirSync(binRoot, { withFileTypes: true });
  } catch {
    return "codex";
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(binRoot, entry.name, "codex.exe");
    try {
      const stat = fsApi.statSync(candidate);
      if (stat.isFile()) candidates.push({ candidate, mtimeMs: stat.mtimeMs });
    } catch {
      // Ignore incomplete or non-CLI runtime directories such as the rg bundle.
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.candidate || "codex";
}

export function resolveCodexCliInvocation(args, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const cliPath = resolveCodexCliPath({ ...options, env, platform });

  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(cliPath)) {
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", cliPath, ...args],
    };
  }

  return { command: cliPath, args };
}
