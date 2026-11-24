import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

export function getPlatformInfo() {
  const platform = os.platform(); // 'darwin', 'linux', 'win32'
  const arch = os.arch();         // 'arm64', 'x64'

  let normalizedPlatform = platform;
  if (platform === "win32") normalizedPlatform = "windows";
  else if (platform === "darwin") normalizedPlatform = "darwin";
  else if (platform === "linux") normalizedPlatform = "linux";

  let normalizedArch = arch;
  if (arch === "x64") normalizedArch = "amd64";
  else if (arch === "arm64") normalizedArch = "arm64";

  return {
    rawPlatform: platform,
    rawArch: arch,
    platform: normalizedPlatform,
    arch: normalizedArch,
    isWindows: platform === "win32",
    isMac: platform === "darwin",
    isLinux: platform === "linux",
  };
}

const DEFAULT_RUNTIME_DIR = path.join(os.homedir(), ".shrimp", "skills", "leo-nat-traversal-router");

/**
 * Resolves the root runtime data directory with fallback hierarchy:
 * 1. Explicit override passed in argument (e.g. from CLI --data-dir)
 * 2. Environment variable LEO_NAT_DATA_DIR
 * 3. Persisted router.json configuration in default directory
 * 4. Default: ~/.shrimp/skills/leo-nat-traversal-router
 */
export function getRuntimeBaseDir(overrideDir = null) {
  if (overrideDir) {
    return path.resolve(overrideDir);
  }

  if (process.env.LEO_NAT_DATA_DIR) {
    return path.resolve(process.env.LEO_NAT_DATA_DIR);
  }

  const routerConfigPath = path.join(DEFAULT_RUNTIME_DIR, "router.json");
  if (fs.existsSync(routerConfigPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(routerConfigPath, "utf-8"));
      if (parsed.dataDir) {
        return path.resolve(parsed.dataDir);
      }
    } catch {
      // ignore
    }
  }

  return DEFAULT_RUNTIME_DIR;
}

/**
 * Persists a custom runtime data directory into router.json
 */
export function setRuntimeBaseDir(newDir) {
  const targetDir = path.resolve(newDir);
  if (!fs.existsSync(DEFAULT_RUNTIME_DIR)) {
    fs.mkdirSync(DEFAULT_RUNTIME_DIR, { recursive: true, mode: 0o755 });
  }

  const routerConfigPath = path.join(DEFAULT_RUNTIME_DIR, "router.json");
  let current = {};
  if (fs.existsSync(routerConfigPath)) {
    try {
      current = JSON.parse(fs.readFileSync(routerConfigPath, "utf-8"));
    } catch {}
  }

  current.dataDir = targetDir;
  fs.writeFileSync(routerConfigPath, JSON.stringify(current, null, 2), "utf-8");
  return { success: true, dataDir: targetDir, routerConfigPath };
}

/**
 * Retrieves global paths
 */
export function getPaths(overrideDir = null) {
  const homeDir = os.homedir();
  const localBinDir = path.join(homeDir, ".local", "bin");
  const runtimeDir = getRuntimeBaseDir(overrideDir);

  return {
    homeDir,
    localBinDir,
    runtimeDir,
  };
}

/**
 * Provides isolated, scalable directory tree for each traversal provider (frp, cloudflare, etc.)
 *
 * Tree structure:
 * <runtimeDir>/
 * ├── router.json
 * └── providers/
 *     ├── frp/
 *     │   ├── config/ (config.json, secrets.json, frpc.toml)
 *     │   ├── run/    (frpc.pid)
 *     │   └── logs/   (frpc.log)
 *     └── cloudflare/
 *         ├── config/
 *         ├── run/
 *         └── logs/
 */
export function getProviderPaths(providerName = "frp", overrideDir = null) {
  const { localBinDir, runtimeDir } = getPaths(overrideDir);
  const providerDir = path.join(runtimeDir, "providers", providerName);
  const configDir = path.join(providerDir, "config");
  const runDir = path.join(providerDir, "run");
  const logsDir = path.join(providerDir, "logs");

  [localBinDir, runtimeDir, providerDir, configDir, runDir, logsDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
  });

  // Seamless migration from legacy flat directory (~/config -> ~/providers/frp/config)
  if (providerName === "frp") {
    const legacyConfigDir = path.join(runtimeDir, "config");
    const targetConfig = path.join(configDir, "config.json");
    if (fs.existsSync(legacyConfigDir) && !fs.existsSync(targetConfig)) {
      try {
        const legacyFiles = fs.readdirSync(legacyConfigDir);
        for (const file of legacyFiles) {
          const src = path.join(legacyConfigDir, file);
          const dest = path.join(configDir, file);
          if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
            fs.copyFileSync(src, dest);
          }
        }
      } catch {}
    }
  }

  return {
    runtimeDir,
    providerName,
    providerDir,
    configDir,
    runDir,
    logsDir,
  };
}

export function ensureDirs(overrideDir = null) {
  return getProviderPaths("frp", overrideDir);
}

export function findExecutable(binName) {
  const { isWindows } = getPlatformInfo();
  const targetName = isWindows && !binName.endsWith(".exe") ? `${binName}.exe` : binName;
  const paths = getPaths();

  // 1. Check ~/.local/bin explicitly
  const localBinPath = path.join(paths.localBinDir, targetName);
  if (fs.existsSync(localBinPath)) {
    try {
      fs.accessSync(localBinPath, fs.constants.X_OK);
      return localBinPath;
    } catch {
      // continue
    }
  }

  // 2. Check PATH via which / where
  try {
    const cmd = isWindows ? `where ${binName}` : `which ${binName}`;
    const stdout = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (stdout) {
      const firstLine = stdout.split(/\r?\n/)[0].trim();
      if (fs.existsSync(firstLine)) return firstLine;
    }
  } catch {
    // not in PATH
  }

  return null;
}
