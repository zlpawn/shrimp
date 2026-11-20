import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const VALID_POLICIES = new Set(["copy", "move", "none"]);

/**
 * Resolve '~' prefix to user's home directory.
 */
export function resolveHome(filepath) {
  if (!filepath) return filepath;
  if (filepath === "~") return os.homedir();
  if (filepath.startsWith("~/") || filepath.startsWith("~\\")) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return path.resolve(filepath);
}

/**
 * Returns configuration path: ~/.shrimp/skills/leo-md-router/config.json
 */
export function getConfigPath() {
  if (process.env.LEO_MD_ROUTER_CONFIG_PATH) {
    return resolveHome(process.env.LEO_MD_ROUTER_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-md-router", "config.json");
}

/**
 * Default global output directory: ~/素材/md
 */
export function getDefaultOutputDir() {
  return path.join(os.homedir(), "素材", "md");
}

/**
 * Read configuration with defaults.
 */
export function readConfig() {
  const cfgPath = getConfigPath();
  const defaults = {
    output_dir: "~/素材/md",
    folder_structure: "category_date_doc",
    source_policy: "copy",
    updated_at: null,
  };

  if (!fs.existsSync(cfgPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(cfgPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const merged = { ...defaults, ...parsed };
    if (!VALID_POLICIES.has(merged.source_policy)) {
      merged.source_policy = defaults.source_policy;
    }
    return merged;
  } catch (err) {
    console.warn(`[leo-md-router] 读取配置文件失败 (${cfgPath}): ${err.message}`);
    return defaults;
  }
}

/**
 * Save configuration patch.
 */
export function saveConfig(patch = {}) {
  const cfgPath = getConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

  if (patch.source_policy !== undefined && !VALID_POLICIES.has(patch.source_policy)) {
    throw new Error(`无效的 source_policy: ${patch.source_policy}（可选: copy | move | none）`);
  }

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
 * Clean string for directory and file segments.
 */
export function sanitizeSegment(str, defaultVal = "doc") {
  if (!str) return defaultVal;
  const clean = String(str)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || defaultVal;
}

/**
 * Format date as YYYY-MM-DD.
 */
export function formatDateYYYYMMDD(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Format timestamp as YYYYMMDD_HHmmss.
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
 * Resolve target destination:
 * <baseDir>/<category>/YYYY-MM-DD/<topic>/<topic>_<engine>_<timestamp>.<ext>
 */
export function resolveMarkdownDestination({
  category = "通用文档",
  topic = "document",
  engine = "docling",
  explicitOutputDir = null,
  explicitFilename = null,
  date = new Date(),
  ext = "md",
} = {}) {
  const config = readConfig();
  const rawBase = explicitOutputDir || config.output_dir || getDefaultOutputDir();
  const baseDir = resolveHome(rawBase);

  const cleanCategory = sanitizeSegment(category, "通用文档");
  const cleanTopic = sanitizeSegment(topic, "document");
  const cleanEngine = sanitizeSegment(engine, "docling");
  const dateFolder = formatDateYYYYMMDD(date);

  const docDir = path.join(baseDir, cleanCategory, dateFolder, cleanTopic);
  const sourceArchiveDir = path.join(docDir, "source");

  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  const timeStr = formatTimestampCompact(date);
  const filename = explicitFilename || `${cleanTopic}_${cleanEngine}_${timeStr}.${cleanExt}`;
  const fullPath = path.join(docDir, filename);

  return {
    baseDir,
    category: cleanCategory,
    dateFolder,
    topic: cleanTopic,
    docDir,
    sourceArchiveDir,
    filename,
    fullPath,
    sourcePolicy: config.source_policy,
  };
}

/**
 * Archive source file into <destDir>/source/ according to policy (copy | move | none).
 * Regardless of directory, deleting the original file ALWAYS requires confirmDelete === true.
 */
export function archiveSourceFile({ srcPath, destDir, policy = null, confirmDelete = false }) {
  const config = readConfig();
  const activePolicy = policy || config.source_policy;

  if (!VALID_POLICIES.has(activePolicy)) {
    throw new Error(`无效的归档策略: ${activePolicy}`);
  }

  if (activePolicy === "none") {
    return { action: "none", archivedPath: null, deletedOriginal: false };
  }

  const absSrc = resolveHome(srcPath);
  if (!fs.existsSync(absSrc)) {
    throw new Error(`源文件不存在: ${absSrc}`);
  }
  const srcStat = fs.statSync(absSrc);
  if (!srcStat.isFile()) {
    throw new Error(`源路径不是普通文件: ${absSrc}`);
  }

  const sourceFolder = path.join(resolveHome(destDir), "source");
  fs.mkdirSync(sourceFolder, { recursive: true });

  const parsed = path.parse(absSrc);
  let targetPath = path.join(sourceFolder, parsed.base);
  if (fs.existsSync(targetPath)) {
    targetPath = path.join(sourceFolder, `${parsed.name}_${formatTimestampCompact()}${parsed.ext}`);
  }

  fs.copyFileSync(absSrc, targetPath);
  const copiedStat = fs.statSync(targetPath);
  if (copiedStat.size !== srcStat.size) {
    throw new Error(`拷贝校验失败，文件大小不一致 (${copiedStat.size} vs ${srcStat.size})`);
  }

  if (activePolicy === "copy") {
    return {
      action: "copy",
      srcPath: absSrc,
      archivedPath: targetPath,
      deletedOriginal: false,
      requiresConfirmation: false,
    };
  }

  // activePolicy === "move": always require explicit user confirmation before deleting original
  if (!confirmDelete) {
    return {
      action: "copied_awaiting_delete_confirmation",
      srcPath: absSrc,
      archivedPath: targetPath,
      deletedOriginal: false,
      requiresConfirmation: true,
      reason: "always_confirm_before_delete",
    };
  }

  fs.unlinkSync(absSrc);
  return {
    action: "move",
    srcPath: absSrc,
    archivedPath: targetPath,
    deletedOriginal: true,
    requiresConfirmation: false,
  };
}

/**
 * Delete original source file ONLY after verifying an archived copy exists with matching size
 * and explicit user confirmation (confirmDelete === true).
 */
export function deleteOriginalAfterArchive({ srcPath, archivedPath, confirmDelete = false }) {
  if (!confirmDelete) {
    return {
      deletedOriginal: false,
      requiresConfirmation: true,
      reason: "always_confirm_before_delete",
    };
  }

  const absSrc = resolveHome(srcPath);
  const absArchived = resolveHome(archivedPath);

  if (!fs.existsSync(absArchived)) {
    throw new Error(`归档副本不存在，拒绝删除源文件: ${absArchived}`);
  }
  if (!fs.existsSync(absSrc)) {
    throw new Error(`源文件不存在: ${absSrc}`);
  }

  const srcStat = fs.statSync(absSrc);
  const archivedStat = fs.statSync(absArchived);
  if (srcStat.size !== archivedStat.size) {
    throw new Error(`归档副本大小与源文件不一致，拒绝删除 (${archivedStat.size} vs ${srcStat.size})`);
  }

  fs.unlinkSync(absSrc);
  return {
    srcPath: absSrc,
    archivedPath: absArchived,
    deletedOriginal: true,
    requiresConfirmation: false,
  };
}

function getArgValue(args, flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`
leo-md-router 存储与源文件归档配置工具

用法:
  node config.mjs get
  node config.mjs set [--dir <path>] [--source-policy copy|move|none]
  node config.mjs resolve --cat <分类> --topic <主题> --engine <docling|markitdown> [--ext md]
  node config.mjs archive-source --src <源文件> --dest-dir <docDir> [--policy copy|move|none] [--confirm-delete]
  node config.mjs delete-original --src <源文件> --archived <归档副本> --confirm-delete
`);
    process.exit(0);
  }

  if (cmd === "get") {
    console.log(JSON.stringify(readConfig(), null, 2));
    process.exit(0);
  }

  if (cmd === "set") {
    const patch = {};
    const newDir = getArgValue(args, "--dir");
    const newPolicy = getArgValue(args, "--source-policy");
    if (newDir) patch.output_dir = newDir;
    if (newPolicy) patch.source_policy = newPolicy;
    if (Object.keys(patch).length === 0) {
      console.error("错误: set 命令至少需要 --dir 或 --source-policy");
      process.exit(1);
    }
    const saved = saveConfig(patch);
    console.log(JSON.stringify(saved, null, 2));
    process.exit(0);
  }

  if (cmd === "resolve") {
    const dest = resolveMarkdownDestination({
      category: getArgValue(args, "--cat", "通用文档"),
      topic: getArgValue(args, "--topic", "document"),
      engine: getArgValue(args, "--engine", "docling"),
      explicitOutputDir: getArgValue(args, "--dir"),
      ext: getArgValue(args, "--ext", "md"),
    });
    console.log(JSON.stringify(dest, null, 2));
    process.exit(0);
  }

  if (cmd === "archive-source") {
    const srcPath = getArgValue(args, "--src");
    const destDir = getArgValue(args, "--dest-dir");
    if (!srcPath || !destDir) {
      console.error("错误: archive-source 需要 --src 与 --dest-dir");
      process.exit(1);
    }
    const result = archiveSourceFile({
      srcPath,
      destDir,
      policy: getArgValue(args, "--policy"),
      confirmDelete: args.includes("--confirm-delete"),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (cmd === "delete-original") {
    const srcPath = getArgValue(args, "--src");
    const archivedPath = getArgValue(args, "--archived");
    if (!srcPath || !archivedPath) {
      console.error("错误: delete-original 需要 --src 与 --archived");
      process.exit(1);
    }
    const result = deleteOriginalAfterArchive({
      srcPath,
      archivedPath,
      confirmDelete: args.includes("--confirm-delete"),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  console.error(`未知子命令: ${cmd}`);
  process.exit(1);
}
