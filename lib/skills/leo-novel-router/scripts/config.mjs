import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const VALID_STYLES = new Set([0, 1, 2]);
const VALID_COLORS = new Set([1, 2, 3, 4, 5]);

/**
 * Resolve '~' prefix to the user's home directory.
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
 * Return config file path: ~/.shrimp/skills/leo-novel-router/config.json
 */
export function getConfigPath() {
  if (process.env.LEO_NOVEL_ROUTER_CONFIG_PATH) {
    return resolveHome(process.env.LEO_NOVEL_ROUTER_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-novel-router", "config.json");
}

/**
 * Return secrets file path: ~/.shrimp/skills/leo-novel-router/secrets.json
 */
export function getSecretsPath() {
  if (process.env.LEO_NOVEL_ROUTER_SECRETS_PATH) {
    return resolveHome(process.env.LEO_NOVEL_ROUTER_SECRETS_PATH);
  }
  return path.join(os.homedir(), ".shrimp", "skills", "leo-novel-router", "secrets.json");
}

/**
 * Read secrets file safely (never stored in config.json or git repo).
 */
export function readSecrets() {
  const secPath = getSecretsPath();
  if (!fs.existsSync(secPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(secPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn(`[leo-novel-router] 读取密钥文件失败 (${secPath}): ${err.message}`);
    return {};
  }
}

/**
 * Save secrets patch with owner-only permissions (0o600).
 */
export function saveSecrets(patch = {}) {
  const secPath = getSecretsPath();
  fs.mkdirSync(path.dirname(secPath), { recursive: true, mode: 0o700 });
  const current = readSecrets();
  const updated = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(secPath, JSON.stringify(updated, null, 2), { encoding: "utf-8", mode: 0o600 });
  return updated;
}

/**
 * Resolve WeRead official gateway API key (env takes precedence over secrets.json).
 */
export function resolveWeReadApiKey() {
  const envKey = String(process.env.WEREAD_API_KEY || "").trim();
  if (envKey) {
    return { apiKey: envKey, source: "env" };
  }
  const secrets = readSecrets();
  const fileKey = String(secrets.weread_api_key || "").trim();
  if (fileKey) {
    return { apiKey: fileKey, source: "secrets" };
  }
  return { apiKey: null, source: null };
}

/**
 * Mask secret token for safe status display.
 */
export function maskSecret(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 8) return "***";
  return `${s.slice(0, 6)}***${s.slice(-3)}`;
}

/**
 * Return default global output directory: ~/素材/novel
 */
export function getDefaultOutputDir() {
  return path.join(os.homedir(), "素材", "novel");
}

/**
 * Read persisted configuration merged with defaults.
 */
export function readConfig() {
  const cfgPath = getConfigPath();
  const defaults = {
    output_dir: "~/素材/novel",
    folder_structure: "book",
    default_platform: "weread",
    default_highlight_style: 0,
    default_highlight_color: 5,
    external_skills: {},
    updated_at: null,
  };

  if (!fs.existsSync(cfgPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(cfgPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const merged = { ...defaults, ...parsed };
    if (!VALID_STYLES.has(merged.default_highlight_style)) {
      merged.default_highlight_style = defaults.default_highlight_style;
    }
    if (!VALID_COLORS.has(merged.default_highlight_color)) {
      merged.default_highlight_color = defaults.default_highlight_color;
    }
    if (!merged.external_skills || typeof merged.external_skills !== "object") {
      merged.external_skills = {};
    }
    return merged;
  } catch (err) {
    console.warn(`[leo-novel-router] 读取配置文件失败 (${cfgPath}): ${err.message}`);
    return defaults;
  }
}

/**
 * Save a partial configuration patch.
 */
export function saveConfig(patch = {}) {
  const cfgPath = getConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

  if (
    patch.default_highlight_style !== undefined &&
    !VALID_STYLES.has(Number(patch.default_highlight_style))
  ) {
    throw new Error(`无效的 default_highlight_style: ${patch.default_highlight_style}（可选: 0 | 1 | 2）`);
  }
  if (
    patch.default_highlight_color !== undefined &&
    !VALID_COLORS.has(Number(patch.default_highlight_color))
  ) {
    throw new Error(`无效的 default_highlight_color: ${patch.default_highlight_color}（可选: 1..5）`);
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
 * Sanitize a single directory or filename segment across Windows and macOS.
 */
export function sanitizeSegment(str, defaultVal = "book") {
  if (!str) return defaultVal;
  const clean = String(str)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^_+|_+$/g, "");
  return clean || defaultVal;
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
 * Resolve book-centric destination:
 * - notes / highlights export: <baseDir>/<bookTitle>/<bookTitle>_划线笔记_<timestamp>.md
 * - chapter pull:            <baseDir>/<bookTitle>/chapters/<idx>_<chapterTitle>.md
 */
export function resolveBookDestination({
  bookTitle = "未命名书籍",
  kind = "notes",
  chapterTitle = null,
  chapterIdx = null,
  explicitOutputDir = null,
  explicitFilename = null,
  date = new Date(),
  ext = "md",
} = {}) {
  const config = readConfig();
  const rawBase = explicitOutputDir || config.output_dir || getDefaultOutputDir();
  const baseDir = resolveHome(rawBase);

  const cleanBook = sanitizeSegment(bookTitle, "未命名书籍");
  const bookDir = path.join(baseDir, cleanBook);
  const chaptersDir = path.join(bookDir, "chapters");

  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  const timeStr = formatTimestampCompact(date);

  let targetDir = bookDir;
  let filename = explicitFilename ? sanitizeSegment(explicitFilename, "export") : null;

  if (kind === "chapter") {
    targetDir = chaptersDir;
    if (!filename) {
      const prefix =
        chapterIdx !== null && chapterIdx !== undefined
          ? `${String(chapterIdx).padStart(3, "0")}_`
          : "";
      const cleanChap = sanitizeSegment(chapterTitle || "chapter", "chapter");
      filename = `${prefix}${cleanChap}.${cleanExt}`;
    } else if (!filename.endsWith(`.${cleanExt}`)) {
      filename = `${filename}.${cleanExt}`;
    }
  } else {
    if (!filename) {
      const label = kind === "notes" ? "划线笔记" : sanitizeSegment(kind, "export");
      filename = `${cleanBook}_${label}_${timeStr}.${cleanExt}`;
    } else if (!filename.endsWith(`.${cleanExt}`)) {
      filename = `${filename}.${cleanExt}`;
    }
  }

  return {
    baseDir,
    bookDir,
    chaptersDir,
    targetDir,
    filename,
    targetPath: path.join(targetDir, filename),
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "get";

  if (cmd === "get") {
    const cfg = readConfig();
    console.log(
      JSON.stringify(
        {
          configPath: getConfigPath(),
          resolvedOutputDir: resolveHome(cfg.output_dir),
          config: cfg,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "set") {
    const patch = {};
    if (args.dir) patch.output_dir = args.dir;
    if (args.style !== undefined) patch.default_highlight_style = Number(args.style);
    if (args.color !== undefined) patch.default_highlight_color = Number(args.color);
    if (args.platform) patch.default_platform = args.platform;
    const updated = saveConfig(patch);
    console.log(
      JSON.stringify(
        {
          ok: true,
          configPath: getConfigPath(),
          resolvedOutputDir: resolveHome(updated.output_dir),
          config: updated,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "resolve") {
    const res = resolveBookDestination({
      bookTitle: args.book || args.title || "未命名书籍",
      kind: args.kind || "notes",
      chapterTitle: args.chapter || null,
      chapterIdx: args["chapter-idx"] !== undefined ? Number(args["chapter-idx"]) : null,
      explicitOutputDir: args.dir || null,
      explicitFilename: args.filename || null,
      ext: args.ext || "md",
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "secrets") {
    const sub = args._[1] || "status";
    if (sub === "set") {
      const key = args["weread-api-key"] || args.key;
      if (!key) {
        console.error("请通过 --weread-api-key <key> 指定微信读书 API Key");
        process.exitCode = 1;
        return;
      }
      saveSecrets({ weread_api_key: String(key).trim() });
      console.log(
        JSON.stringify(
          {
            ok: true,
            secretsPath: getSecretsPath(),
            wereadApiKeyConfigured: true,
            maskedKey: maskSecret(String(key).trim()),
          },
          null,
          2
        )
      );
      return;
    }
    const resolved = resolveWeReadApiKey();
    console.log(
      JSON.stringify(
        {
          ok: true,
          secretsPath: getSecretsPath(),
          wereadApiKeyConfigured: Boolean(resolved.apiKey),
          source: resolved.source,
          maskedKey: maskSecret(resolved.apiKey),
        },
        null,
        2
      )
    );
    return;
  }

  console.error(`未知命令: ${cmd}（可用: get | set | resolve | secrets）`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
