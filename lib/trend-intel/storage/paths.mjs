import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function resolveDataDir(overrideDir = null) {
  if (overrideDir) {
    if (!fs.existsSync(overrideDir)) {
      fs.mkdirSync(overrideDir, { recursive: true });
    }
    return overrideDir;
  }
  if (process.env.TREND_INTEL_DATA_DIR) {
    const p = process.env.TREND_INTEL_DATA_DIR;
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
  }
  // Source run check: if ./package.json and .git exist, use ./output/trend-intel
  const projectRoot = process.cwd();
  if (fs.existsSync(path.join(projectRoot, "package.json")) && fs.existsSync(path.join(projectRoot, ".git"))) {
    const localDir = path.join(projectRoot, "output", "trend-intel");
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    return localDir;
  }
  const homeDir = path.join(os.homedir(), ".shrimp", "trend-intel");
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  return homeDir;
}
