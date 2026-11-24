import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { getPlatformInfo, getPaths, ensureDirs, findExecutable } from "../../core/system.mjs";

const DEFAULT_FRP_VERSION = "0.72.0";

/**
 * Fetches the latest published release tag from GitHub.
 * Returns clean version (e.g. "0.72.0"). Fallback to DEFAULT_FRP_VERSION if offline.
 */
export async function getLatestFrpRelease(timeoutMs = 4000) {
  try {
    const output = execSync(
      `curl -s --connect-timeout ${Math.round(timeoutMs / 1000)} https://api.github.com/repos/fatedier/frp/releases/latest`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const match = output.match(/"tag_name":\s*"v?([^"]+)"/);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch {
    // network or rate limit failure
  }
  return DEFAULT_FRP_VERSION;
}

/**
 * Compares two semantic version strings (e.g. "0.71.0" and "0.72.0").
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
export function compareVersions(v1, v2) {
  const parse = (v) => String(v || "").replace(/^v/, "").split(".").map(Number);
  const p1 = parse(v1);
  const p2 = parse(v2);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

/**
 * Probes the system for frpc binary.
 */
export function probeFrpc() {
  const binPath = findExecutable("frpc");
  if (!binPath) {
    return {
      installed: false,
      version: null,
      binPath: null,
      location: null,
    };
  }

  try {
    const versionOutput = execSync(`"${binPath}" -v`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return {
      installed: true,
      version: versionOutput,
      binPath,
      location: binPath.includes(".local/bin") ? "local-bin" : "system",
    };
  } catch (err) {
    return {
      installed: true,
      version: "unknown",
      binPath,
      location: "broken",
      error: err.message,
    };
  }
}

/**
 * Checks whether an update is available on GitHub releases.
 */
export async function checkFrpcUpdate() {
  const probe = probeFrpc();
  const latestVersion = await getLatestFrpRelease();

  if (!probe.installed) {
    return {
      installed: false,
      currentVersion: null,
      latestVersion,
      hasUpdate: true,
      canUpgrade: true,
    };
  }

  const cmp = compareVersions(probe.version, latestVersion);
  return {
    installed: true,
    currentVersion: probe.version,
    latestVersion,
    hasUpdate: cmp < 0,
    isLatest: cmp >= 0,
    binPath: probe.binPath,
  };
}

/**
 * Downloads and installs frpc to ~/.local/bin/frpc
 */
export async function installFrpc({ version = null, force = false } = {}) {
  const targetVersion = version || (await getLatestFrpRelease());
  const current = probeFrpc();
  if (current.installed && !force && current.version === targetVersion) {
    return {
      success: true,
      alreadyInstalled: true,
      version: current.version,
      binPath: current.binPath,
    };
  }

  const { isWindows, platform, arch } = getPlatformInfo();
  const paths = ensureDirs();
  const cleanVersion = targetVersion.replace(/^v/, "");

  // Build archive name, e.g. frp_0.72.0_darwin_arm64.tar.gz
  const ext = isWindows ? "zip" : "tar.gz";
  const baseName = `frp_${cleanVersion}_${platform}_${arch}`;
  const archiveName = `${baseName}.${ext}`;
  const downloadUrl = `https://github.com/fatedier/frp/releases/download/v${cleanVersion}/${archiveName}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frpc-install-"));
  const archivePath = path.join(tmpDir, archiveName);
  const targetBinName = isWindows ? "frpc.exe" : "frpc";
  const finalDest = path.join(paths.localBinDir, targetBinName);

  try {
    // 1. Download archive using curl for reliable streaming and proxy respect
    execSync(`curl -fL --retry 3 --connect-timeout 15 -o "${archivePath}" "${downloadUrl}"`, {
      stdio: ["ignore", "pipe", "inherit"],
    });

    if (!fs.existsSync(archivePath) || fs.statSync(archivePath).size === 0) {
      throw new Error(`Failed to download frp archive from ${downloadUrl}`);
    }

    // 2. Extract archive
    const extractDir = path.join(tmpDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    if (isWindows) {
      execSync(`tar -xf "${archivePath}" -C "${extractDir}"`, { stdio: "ignore" });
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: "ignore" });
    }

    // 3. Locate frpc inside extracted contents
    let foundFrpcPath = null;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name === targetBinName) {
          foundFrpcPath = full;
          return;
        }
      }
    };
    walk(extractDir);

    if (!foundFrpcPath) {
      throw new Error(`Could not find ${targetBinName} in extracted archive ${archiveName}`);
    }

    // 4. Copy to ~/.local/bin/
    fs.copyFileSync(foundFrpcPath, finalDest);
    if (!isWindows) {
      fs.chmodSync(finalDest, 0o755);
    }

    // 5. Verify installation
    const verified = probeFrpc();
    if (!verified.installed) {
      throw new Error(`Installation completed but frpc verification failed at ${finalDest}`);
    }

    return {
      success: true,
      alreadyInstalled: false,
      version: verified.version,
      binPath: verified.binPath,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore tmp cleanup error
    }
  }
}

/**
 * Upgrades frpc to the latest (or specified) version with running supervisor awareness.
 * If frpc was running before upgrade, it gracefully stops, updates, and restarts.
 */
export async function upgradeFrpc({ targetVersion = null, force = false, supervisor = null } = {}) {
  const current = probeFrpc();
  const latestVersion = targetVersion || (await getLatestFrpRelease());

  if (current.installed && !force && compareVersions(current.version, latestVersion) >= 0) {
    return {
      success: true,
      alreadyLatest: true,
      version: current.version,
      binPath: current.binPath,
      message: `frpc is already at the latest version (${current.version}). Use --force to reinstall.`,
    };
  }

  let wasRunning = false;
  if (supervisor && typeof supervisor.statusFrpc === "function") {
    const st = supervisor.statusFrpc();
    if (st.status === "running") {
      wasRunning = true;
      supervisor.stopFrpc();
    }
  }

  const installRes = await installFrpc({ version: latestVersion, force: true });

  let restarted = false;
  if (wasRunning && supervisor && typeof supervisor.startFrpc === "function") {
    try {
      supervisor.startFrpc();
      restarted = true;
    } catch {
      // restart warning
    }
  }

  return {
    success: true,
    previousVersion: current.version || "none",
    version: installRes.version,
    binPath: installRes.binPath,
    wasRunning,
    restarted,
    message: `frpc upgraded from ${current.version || "none"} to ${installRes.version}`,
  };
}

/**
 * Uninstalls frpc from ~/.local/bin/
 */
export function uninstallFrpc() {
  const { isWindows } = getPlatformInfo();
  const paths = getPaths();
  const targetBinName = isWindows ? "frpc.exe" : "frpc";
  const localDest = path.join(paths.localBinDir, targetBinName);

  let removed = false;
  if (fs.existsSync(localDest)) {
    fs.unlinkSync(localDest);
    removed = true;
  }

  const check = probeFrpc();
  return {
    success: true,
    removedFromLocalBin: removed,
    remainingSystemFrpc: check.installed ? check.binPath : null,
  };
}
