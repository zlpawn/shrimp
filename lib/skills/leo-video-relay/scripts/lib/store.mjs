import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILL_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const VIDEO_EXTS = new Set([".mp4", ".mkv", ".mov", ".webm", ".avi", ".flv", ".m4v", ".ts", ".wmv"]);

export const homeDir = () => process.env.LEO_VIDEO_RELAY_HOME || path.join(os.homedir(), ".shrimp", "skills", path.basename(SKILL_ROOT));
export const workDir = () => path.join(homeDir(), "work");

export function expandHome(p) {
  if (p === "~") return os.homedir();
  return /^~[\\/]/.test(p) ? path.join(os.homedir(), p.slice(2)) : path.resolve(p);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT" && fallback !== undefined) return fallback;
    throw new Error(`无法读取 ${file}：${err.message}`);
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function loadConfig() {
  const cfg = readJson(path.join(homeDir(), "config.json"), {});
  return {
    default_workspace_dir: cfg.default_workspace_dir || path.join(homeDir(), "output"),
    routes: cfg.routes || {},
  };
}

export const saveConfig = (cfg) => writeJson(path.join(homeDir(), "config.json"), cfg);

export function loadRegistry() {
  const reg = readJson(path.join(homeDir(), "registry.json"), {});
  return { videos: reg.videos || {} };
}

export const saveRegistry = (reg) => writeJson(path.join(homeDir(), "registry.json"), reg);

/** A registry entry only counts while its published directory still exists. */
export function findPublished(reg, { id, url }) {
  const hit = id ? reg.videos[id] : Object.values(reg.videos).find((v) => url && v.urls?.includes(url));
  return hit && fs.existsSync(hit.dir) ? hit : null;
}

export async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function fmtTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${String(m).padStart(2, "0")}:${rest}`;
}

export function slugify(text) {
  const slug = String(text || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 60);
  return slug || "video";
}

export function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

/** Moves a directory, falling back to copy-and-delete across volumes. */
export function moveDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

export function freeDirName(parent, name) {
  let candidate = path.join(parent, name);
  for (let i = 2; fs.existsSync(candidate); i += 1) candidate = path.join(parent, `${name}-${i}`);
  return candidate;
}

/** Skills install side by side; an explicit directory covers any other layout. */
export function findSkill(name, explicitDir) {
  const dir = explicitDir ? expandHome(explicitDir) : path.join(path.dirname(SKILL_ROOT), name);
  return fs.existsSync(path.join(dir, "SKILL.md")) ? dir : null;
}

export function listScenes() {
  const dir = path.join(SKILL_ROOT, "references", "scenes");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((file) => {
    const head = fs.readFileSync(path.join(dir, file), "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
    const field = (key) => head.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
    return { name: field("name") || file.replace(/\.md$/, ""), when: field("when"), output: field("output"), file: path.join(dir, file) };
  });
}
