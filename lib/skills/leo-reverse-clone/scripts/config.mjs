import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const VALID_POLICIES = new Set(["copy", "move", "none"]);
const VALID_MODES = new Set(["deep", "clean_room"]);

/**
 * Resolve '~' prefix to user's home directory (cross-platform macOS/Linux/Windows).
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
 * Returns configuration path: ~/.shrimp/skills/leo-reverse-clone/config.json
 */
export function getConfigPath() {
  if (process.env.LEO_REVERSE_CLONE_CONFIG_PATH) {
    return resolveHome(process.env.LEO_REVERSE_CLONE_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-reverse-clone", "config.json");
}

/**
 * Default global output directory: ~/素材/reverse-clone
 */
export function getDefaultOutputDir() {
  return path.join(os.homedir(), "素材", "reverse-clone");
}

/**
 * Read configuration with defaults.
 */
export function readConfig() {
  const cfgPath = getConfigPath();
  const defaults = {
    output_dir: "~/素材/reverse-clone",
    default_mode: "deep",
    source_policy: "copy",
    proxy: null,
    idle_timeout_secs: 1800,
    rea_bin: null,
    craft_bin: null,
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
    if (!VALID_MODES.has(merged.default_mode)) {
      merged.default_mode = defaults.default_mode;
    }
    return merged;
  } catch (err) {
    console.warn(`[leo-reverse-clone] 读取配置文件失败 (${cfgPath}): ${err.message}`);
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
  if (patch.default_mode !== undefined && !VALID_MODES.has(patch.default_mode)) {
    throw new Error(`无效的 default_mode: ${patch.default_mode}（可选: deep | clean_room）`);
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
 * Clean string for safe cross-platform directory and file segments.
 */
export function sanitizeSegment(str, defaultVal = "target") {
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
 * Resolve project destination:
 * <baseDir>/<category>/YYYY-MM-DD/<targetName>/
 */
export function resolveProjectDestination({
  category = "app",
  targetName = "target",
  engine = "rea",
  mode = null,
  explicitOutputDir = null,
  date = new Date(),
} = {}) {
  const config = readConfig();
  const rawBase = explicitOutputDir || config.output_dir || getDefaultOutputDir();
  const baseDir = resolveHome(rawBase);

  const cleanCategory = sanitizeSegment(category, "app");
  const cleanTarget = sanitizeSegment(targetName, "target");
  const cleanEngine = sanitizeSegment(engine, "rea");
  const activeMode = VALID_MODES.has(mode) ? mode : config.default_mode;
  const dateFolder = formatDateYYYYMMDD(date);

  const projectDir = path.join(baseDir, cleanCategory, dateFolder, cleanTarget);
  return {
    baseDir,
    category: cleanCategory,
    dateFolder,
    targetName: cleanTarget,
    engine: cleanEngine,
    mode: activeMode,
    projectDir,
    sourceDir: path.join(projectDir, "source"),
    evidenceDir: path.join(projectDir, "evidence"),
    appDir: path.join(projectDir, "app"),
    verifyDir: path.join(projectDir, "verify"),
    specPath: path.join(projectDir, "spec.md"),
    metaPath: path.join(projectDir, "project.json"),
    sourcePolicy: config.source_policy,
  };
}

/**
 * Initialize a standard reverse-clone project directory layout.
 */
export function initProjectWorkspace({
  category = "app",
  targetName = "target",
  engine = "rea",
  mode = null,
  targetRef = null,
  stack = null,
  explicitOutputDir = null,
  date = new Date(),
} = {}) {
  const dest = resolveProjectDestination({
    category,
    targetName,
    engine,
    mode,
    explicitOutputDir,
    date,
  });

  for (const dir of [dest.projectDir, dest.sourceDir, dest.evidenceDir, dest.appDir, dest.verifyDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const now = new Date().toISOString();
  const existing = fs.existsSync(dest.metaPath)
    ? JSON.parse(fs.readFileSync(dest.metaPath, "utf-8").replace(/^\uFEFF/, ""))
    : null;

  const meta = {
    version: 1,
    name: dest.targetName,
    category: dest.category,
    engine: dest.engine,
    mode: dest.mode,
    target: targetRef ?? existing?.target ?? null,
    target_stack: stack ?? existing?.target_stack ?? null,
    stage: existing?.stage ?? "study",
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  fs.writeFileSync(dest.metaPath, JSON.stringify(meta, null, 2), { encoding: "utf-8" });

  if (!fs.existsSync(dest.specPath)) {
    const specStub = [
      `# ${dest.targetName} 逆向分析与 1:1 复刻规格书`,
      "",
      `- **目标类别**：${dest.category}`,
      `- **主力引擎**：${dest.engine}`,
      `- **分析模式**：${dest.mode}`,
      `- **原始目标**：${meta.target || "待补充"}`,
      `- **目标复刻技术栈**：${meta.target_stack || "待确认"}`,
      "",
      "## 1. 功能清单与核心行为（附证据 ID）",
      "",
      "## 2. 界面/路由/交互状态映射",
      "",
      "## 3. 数据模型、存储与接口协议（含本地替身/Mock 方案）",
      "",
      "## 4. 核心算法与边界限制（Observed / Derived / Inferred / Unknown）",
      "",
      "## 5. 验收核对项",
      "",
    ].join("\n");
    fs.writeFileSync(dest.specPath, specStub, { encoding: "utf-8" });
  }

  return { ...dest, meta };
}

/**
 * Archive original source file into <destDir>/source/ according to policy (copy | move | none).
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

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`
leo-reverse-clone 工程目录与归档配置工具

用法:
  node config.mjs get
  node config.mjs set [--dir <path>] [--mode deep|clean_room] [--source-policy copy|move|none] [--rea-bin <path>] [--craft-bin <path>]
  node config.mjs resolve --cat <类别> --name <目标名> [--engine rea|craft-anything|hybrid] [--mode deep|clean_room]
  node config.mjs init --cat <类别> --name <目标名> [--engine rea|craft-anything|hybrid] [--target <路径或URL>] [--stack <技术栈>]
  node config.mjs archive-source --src <源文件> --dest-dir <projectDir> [--policy copy|move|none] [--confirm-delete]
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
    const newMode = getArgValue(args, "--mode");
    const newPolicy = getArgValue(args, "--source-policy");
    const newProxy = getArgValue(args, "--proxy");
    const reaBin = getArgValue(args, "--rea-bin");
    const craftBin = getArgValue(args, "--craft-bin");
    if (newDir) patch.output_dir = newDir;
    if (newMode) patch.default_mode = newMode;
    if (newPolicy) patch.source_policy = newPolicy;
    if (args.includes("--no-proxy")) patch.proxy = "direct";
    else if (newProxy !== null) patch.proxy = newProxy;
    if (reaBin) patch.rea_bin = reaBin;
    if (craftBin) patch.craft_bin = craftBin;
    if (Object.keys(patch).length === 0) {
      console.error("错误: set 命令至少需要一个配置项参数");
      process.exit(1);
    }
    console.log(JSON.stringify(saveConfig(patch), null, 2));
    process.exit(0);
  }

  if (cmd === "resolve") {
    const dest = resolveProjectDestination({
      category: getArgValue(args, "--cat", "app"),
      targetName: getArgValue(args, "--name", "target"),
      engine: getArgValue(args, "--engine", "rea"),
      mode: getArgValue(args, "--mode"),
      explicitOutputDir: getArgValue(args, "--dir"),
    });
    console.log(JSON.stringify(dest, null, 2));
    process.exit(0);
  }

  if (cmd === "init") {
    const result = initProjectWorkspace({
      category: getArgValue(args, "--cat", "app"),
      targetName: getArgValue(args, "--name", "target"),
      engine: getArgValue(args, "--engine", "rea"),
      mode: getArgValue(args, "--mode"),
      targetRef: getArgValue(args, "--target"),
      stack: getArgValue(args, "--stack"),
      explicitOutputDir: getArgValue(args, "--dir"),
    });
    console.log(JSON.stringify(result, null, 2));
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
