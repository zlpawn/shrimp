import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Resolve '~' prefix to user's home directory
 */
export function resolveHome(filepath) {
  if (!filepath) return filepath;
  if (filepath.startsWith("~" + path.sep) || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return path.resolve(filepath);
}

/**
 * Returns configuration path: ~/.shrimp/skills/leo-imagine-router/config.json
 */
export function getConfigPath() {
  if (process.env.LEO_IMAGINE_ROUTER_CONFIG_PATH) {
    return resolveHome(process.env.LEO_IMAGINE_ROUTER_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-imagine-router", "config.json");
}

/**
 * Default global output directory: ~/素材/imagine
 */
export function getDefaultOutputDir() {
  return path.join(os.homedir(), "素材", "imagine");
}

/**
 * Read configuration
 */
export function readConfig() {
  const cfgPath = getConfigPath();
  const defaults = {
    output_dir: "~/素材/imagine",
    folder_structure: "category_date", // <category>/YYYY-MM-DD/
    updated_at: null,
  };

  if (!fs.existsSync(cfgPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(cfgPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch (err) {
    console.warn(`[leo-imagine-router] 读取配置文件失败 (${cfgPath}): ${err.message}`);
    return defaults;
  }
}

/**
 * Save configuration
 */
export function saveConfig(patch = {}) {
  const cfgPath = getConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

  const current = readConfig();
  const updated = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), { encoding: "utf-8", mode: 0o600 });
  return updated;
}

/**
 * Clean string for directory and file names
 */
export function sanitizeSegment(str, defaultVal = "misc") {
  if (!str) return defaultVal;
  const clean = String(str)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || defaultVal;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateYYYYMMDD(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Format timestamp as YYYYMMDD_HHmmss
 */
export function formatTimestampCompact(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}_` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

/**
 * Generate standardized semantic filename: <topic>_<style>_<timestamp>.<ext>
 */
export function generateStandardFilename(topic = "image", style = "default", date = new Date(), ext = "png") {
  const cleanTopic = sanitizeSegment(topic, "image");
  const cleanStyle = sanitizeSegment(style, "default");
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  const timeStr = formatTimestampCompact(date);
  return `${cleanTopic}_${cleanStyle}_${timeStr}.${cleanExt}`;
}

/**
 * Resolve target destination according to Router standard:
 * <baseDir>/<category>/YYYY-MM-DD/<topic>_<style>_<timestamp>.ext
 */
export function resolveImageDestination({
  category = "通用出图",
  topic = "image",
  style = "default",
  explicitOutputDir = null,
  explicitFilename = null,
  date = new Date(),
  ext = "png",
} = {}) {
  const config = readConfig();
  const rawBase = explicitOutputDir || config.output_dir || getDefaultOutputDir();
  const baseDir = resolveHome(rawBase);

  const cleanCategory = sanitizeSegment(category, "通用出图");
  const dateFolder = formatDateYYYYMMDD(date);
  const targetDir = path.join(baseDir, cleanCategory, dateFolder);

  const filename = explicitFilename || generateStandardFilename(topic, style, date, ext);
  const fullPath = path.join(targetDir, filename);

  return {
    baseDir,
    category: cleanCategory,
    dateFolder,
    targetDir,
    filename,
    fullPath,
  };
}

// CLI handler if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`
leo-imagine-router 存储与目录配置管理工具

用法:
  node config.mjs get                         查看当前存储与归档配置
  node config.mjs set --dir <path>            设置全局输出根目录 (自动写入 ~/.shrimp/skills/leo-imagine-router/config.json)
  node config.mjs resolve --cat <cat> --topic <topic> --style <style>
                                              预览指定场景的目录与文件名解析结果
`);
    process.exit(0);
  }

  if (cmd === "get") {
    const cfg = readConfig();
    console.log(JSON.stringify(cfg, null, 2));
    process.exit(0);
  }

  if (cmd === "set") {
    const dirIdx = args.indexOf("--dir");
    if (dirIdx === -1 || !args[dirIdx + 1]) {
      console.error("错误: set 命令需要指定 --dir <path>");
      process.exit(1);
    }
    const newDir = args[dirIdx + 1];
    const saved = saveConfig({ output_dir: newDir });
    console.log(`[leo-imagine-router] 输出目录已成功保存并持久化: ${saved.output_dir}`);
    process.exit(0);
  }

  if (cmd === "resolve") {
    const getArg = (flag, def) => {
      const idx = args.indexOf(flag);
      return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
    };
    const category = getArg("--cat", "海报艺术");
    const topic = getArg("--topic", "西游记");
    const style = getArg("--style", "写意双重曝光海报");
    const dest = resolveImageDestination({ category, topic, style });
    console.log("解析目标目录与文件:", JSON.stringify(dest, null, 2));
    process.exit(0);
  }

  console.error(`未知子命令: ${cmd}。使用 --help 查看用法。`);
  process.exit(1);
}
