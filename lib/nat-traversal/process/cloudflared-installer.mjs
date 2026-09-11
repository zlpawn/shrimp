import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCloudflaredBin } from "./cloudflared-supervisor.mjs";

export function resolveNpmBin({ platform = process.platform, existsSync = fs.existsSync } = {}) {
  // 1. Check directory where current node executable is running (e.g. nvm, Homebrew, Volta)
  const nodeDir = path.dirname(process.execPath);
  const npmInNodeDir = path.join(nodeDir, platform === "win32" ? "npm.cmd" : "npm");
  if (existsSync(npmInNodeDir)) {
    return npmInNodeDir;
  }

  // 2. Fall back to standard command name on PATH
  return platform === "win32" ? "npm.cmd" : "npm";
}

export async function installCloudflared({
  packageManager = "npm",
  timeoutMs = 180000,
  logger = console,
  spawnRunner,
  whichBin,
  platform = process.platform,
} = {}) {
  const pm = String(packageManager || "npm").toLowerCase().trim();
  let cmd = "";
  let args = [];

  if (pm === "brew") {
    cmd = "brew";
    args = ["install", "cloudflared"];
  } else if (pm === "winget") {
    cmd = "winget";
    args = ["install", "--id", "Cloudflare.cloudflared"];
  } else {
    // default npm
    cmd = resolveNpmBin({ platform });
    args = ["install", "-g", "cloudflared"];
  }

  logger.info?.(`[cloudflared-installer] Starting installation: ${cmd} ${args.join(" ")}`);

  return new Promise((resolve) => {
    let output = "";
    let finished = false;
    let timer = null;

    function done(res) {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(res);
    }

    timer = setTimeout(() => {
      done({
        ok: false,
        error: `Installation timed out after ${Math.round(timeoutMs / 1000)}s`,
        output: output.trim(),
        binPath: "",
      });
    }, timeoutMs);

    try {
      if (typeof spawnRunner === "function") {
        const proc = spawnRunner(cmd, args, { output, done });
        if (proc && typeof proc.then === "function") {
          proc.then(done).catch((err) => {
            done({
              ok: false,
              error: err?.message || String(err),
              output: output.trim(),
              binPath: "",
            });
          });
        }
        return;
      }

      const child = spawn(cmd, args, {
        shell: platform === "win32",
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        logger.debug?.(`[cloudflared-installer:stdout] ${text}`);
      });

      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        logger.debug?.(`[cloudflared-installer:stderr] ${text}`);
      });

      child.on("error", (err) => {
        logger.error?.(`[cloudflared-installer] Process error: ${err.message}`);
        done({
          ok: false,
          error: `Failed to execute ${cmd}: ${err.message}`,
          output: output.trim(),
          binPath: "",
        });
      });

      child.on("close", (code) => {
        logger.info?.(`[cloudflared-installer] Process exited with code ${code}`);
        const binPath = resolveCloudflaredBin({ whichBin, platform });
        if (code === 0) {
          done({
            ok: true,
            message: "cloudflared installed successfully",
            output: output.trim(),
            binPath,
          });
        } else {
          done({
            ok: false,
            error: `Installation failed with exit code ${code}`,
            output: output.trim(),
            binPath,
          });
        }
      });
    } catch (err) {
      done({
        ok: false,
        error: err?.message || String(err),
        output: output.trim(),
        binPath: "",
      });
    }
  });
}
