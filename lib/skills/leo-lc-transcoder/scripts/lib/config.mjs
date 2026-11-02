// 用户级配置与登录态：~/.shrimp/skills/leo-lc-transcoder/（测试时用 LC_TRANSCODER_HOME 覆盖）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CONFIG = { site: "leetcode-com", display_lang: "zh", vault_root: null, java_home: null, study_start: null };

export function homeDir() {
  return process.env.LC_TRANSCODER_HOME || path.join(os.homedir(), ".shrimp", "skills", "leo-lc-transcoder");
}

const fileOf = (name) => path.join(homeDir(), name);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode });
  if (mode) fs.chmodSync(file, mode); // 文件已存在时 writeFileSync 不会改权限
}

export const configExists = () => fs.existsSync(fileOf("config.json"));

export const readConfig = () => ({ ...DEFAULT_CONFIG, ...readJson(fileOf("config.json")) });

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch, updated_at: new Date().toISOString() };
  writeJson(fileOf("config.json"), next);
  return next;
}

export const readCredentials = () => readJson(fileOf("credentials.json"));

export function writeCredentials(creds) {
  writeJson(fileOf("credentials.json"), { ...creds, fetched_at: new Date().toISOString() }, 0o600);
}
