import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_CONFIG = {
  default_ratio: "16:9",
  default_format: "mp4",
  output_dir: "~/素材/gemini-videos",
  auto_cover: true,
  timeout_sec: 180,
  driver: "lantern"
};

export function getConfigPath() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-antigravity-video", "config.json");
}

export function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, "");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    // 忽略异常，降级到默认配置
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(patch) {
  const cfgPath = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const current = loadConfig();
    const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
    fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  } catch (err) {
    console.warn("⚠️ 保存配置失败:", err.message);
    return null;
  }
}

export function expandTilde(filepath) {
  if (!filepath) return filepath;
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

export function resolveOutputDir(cliDir) {
  if (cliDir) {
    const resolved = path.resolve(expandTilde(cliDir));
    saveConfig({ output_dir: cliDir });
    return resolved;
  }
  if (process.env.LEO_ANTIGRAVITY_VIDEO_OUT) {
    return path.resolve(expandTilde(process.env.LEO_ANTIGRAVITY_VIDEO_OUT));
  }
  const cfg = loadConfig();
  if (cfg.output_dir) {
    return path.resolve(expandTilde(cfg.output_dir));
  }
  return path.resolve(os.homedir(), "素材", "gemini-videos");
}
