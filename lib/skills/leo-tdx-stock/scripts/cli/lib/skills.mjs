import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractZipBuffer } from "./zip.mjs";

const DEFAULT_SKILLHUB_BASE_URL = "https://www.tdx.com.cn/skillhub/download";
const META_FILENAME = ".skillhub-meta.json";

export const SKILLHUB_CATALOG = [
  {
    id: "tdx-financial-quick-read",
    name: "通达信·财报速读",
    group: "research",
    platforms: ["darwin", "linux", "win32"],
    summary: "三表核心指标提取、多期趋势对比、七维财务异常检测、ROE 杜邦拆解与同业对标。",
  },
  {
    id: "tdx-stock-analysis",
    name: "通达信·个股深度分析",
    group: "research",
    platforms: ["darwin", "linux", "win32"],
    summary: "A 股九维结构化“个股一页纸”深度研究报告。",
  },
  {
    id: "tdx-gszddf",
    name: "通达信·公司质地打分",
    group: "research",
    platforms: ["darwin", "linux", "win32"],
    summary: "七维 100 分制基本面质地评估，区分“好公司”与“好股票”。",
  },
  {
    id: "tdx-valuation-navigator",
    name: "通达信·估值导航员",
    group: "research",
    platforms: ["darwin", "linux", "win32"],
    summary: "估值方法选择、市场预期拆解、重估/杀估值触发分析及通达信字段单位防错。",
  },
  {
    id: "tdx-dragon-tiger-miner",
    name: "通达信·龙虎榜掘金",
    group: "research",
    platforms: ["darwin", "linux", "win32"],
    summary: "龙虎榜席位分类（机构/北向/游资）、买卖力量评分与三日榜预警。",
  },
  {
    id: "tdx-yjygby",
    name: "通达信·业绩预告博弈",
    group: "research",
    platforms: ["darwin", "linux", "win32"],
    summary: "业绩预告/快报预期差、股价位置评估、多情景推演与交易策略矩阵。",
  },
  {
    id: "tdx-aidata",
    name: "通达信AiData",
    group: "quant",
    platforms: ["darwin", "linux", "win32"],
    summary: "跨平台 Python TdxAiData（tqs）本地量化/高频数据接口手册（行情、分笔、集合竞价、批量取数）。",
  },
];

const CATALOG_MAP = new Map(SKILLHUB_CATALOG.map((item) => [item.id, item]));

export function resolveSkillRoots({
  homeDir = os.homedir(),
  env = process.env,
  centralDir = null,
  linkDir = null,
} = {}) {
  const central = centralDir
    ? path.resolve(centralDir)
    : path.resolve(String(env.SHRIMP_AGENTS_SKILLS_DIR || "").trim() || path.join(homeDir, ".agents", "skills"));
  const antigravity = linkDir
    ? path.resolve(linkDir)
    : path.resolve(String(env.SHRIMP_ANTIGRAVITY_SKILLS_DIR || "").trim() || path.join(homeDir, ".gemini", "config", "skills"));
  return { central, antigravity };
}

export function getCatalogItem(id) {
  return CATALOG_MAP.get(id) || null;
}

export function resolveTargetIds({ ids = [], research = false, quant = false, all = false, platform = process.platform } = {}) {
  if (ids.length > 0) {
    for (const id of ids) {
      if (!CATALOG_MAP.has(id)) {
        throw new Error(`Unknown SkillHub skill: ${id}. Run 'leo-tdx skills list' to inspect available IDs.`);
      }
    }
    return [...new Set(ids)];
  }
  const selected = SKILLHUB_CATALOG.filter((item) => {
    if (research && item.group !== "research") return false;
    if (quant && item.group !== "quant") return false;
    if (!research && !quant && !all) return false;
    return item.platforms.includes(platform);
  });
  return selected.map((item) => item.id);
}

export function readInstalledSkillInfo(id, roots) {
  const dir = path.join(roots.central, id);
  const skillFile = path.join(dir, "SKILL.md");
  const installed = fs.existsSync(skillFile);
  const meta = readJsonSafe(path.join(dir, META_FILENAME));
  const skillJson = readJsonSafe(path.join(dir, "skill.json"));
  let version = meta?.version || skillJson?.version || null;
  if (!version && installed) {
    version = parseFrontmatterVersion(fs.readFileSync(skillFile, "utf8"));
  }

  const linkPath = path.join(roots.antigravity, id);
  const linkStatus = inspectClientLink(dir, linkPath);
  return {
    installed,
    dir: installed ? dir : null,
    version,
    meta,
    linkPath,
    linkStatus,
  };
}

export async function getSkillsStatus({
  ids = [],
  remote = false,
  homeDir = os.homedir(),
  env = process.env,
  centralDir = null,
  linkDir = null,
  fetchImpl = fetch,
} = {}) {
  const roots = resolveSkillRoots({ homeDir, env, centralDir, linkDir });
  const targetList = ids.length > 0
    ? resolveTargetIds({ ids }).map((id) => CATALOG_MAP.get(id))
    : SKILLHUB_CATALOG;

  const baseUrl = resolveBaseUrl(env);
  const items = await Promise.all(targetList.map(async (item) => {
    const local = readInstalledSkillInfo(item.id, roots);
    const entry = {
      id: item.id,
      name: item.name,
      group: item.group,
      platforms: item.platforms,
      summary: item.summary,
      installed: local.installed,
      localVersion: local.version,
      dir: local.dir,
      linkPath: local.linkPath,
      linkStatus: local.linkStatus,
    };
    if (remote) {
      const remoteInfo = await fetchRemoteInfo(item.id, { baseUrl, fetchImpl });
      entry.remoteVersion = remoteInfo.version;
      entry.etag = remoteInfo.etag;
      entry.updateAvailable = local.installed
        ? hasRemoteUpdate(local, remoteInfo)
        : false;
      if (remoteInfo.error) entry.remoteError = remoteInfo.error;
    }
    return entry;
  }));

  return {
    roots,
    skills: items,
  };
}

export async function installSkills({
  ids = [],
  research = false,
  quant = false,
  all = false,
  force = false,
  link = true,
  homeDir = os.homedir(),
  env = process.env,
  centralDir = null,
  linkDir = null,
  platform = process.platform,
  fetchImpl = fetch,
} = {}) {
  const targetIds = resolveTargetIds({ ids, research, quant, all, platform });
  if (!targetIds.length) {
    throw new Error("Specify skill ID(s), --research, --quant, or --all.");
  }
  const roots = resolveSkillRoots({ homeDir, env, centralDir, linkDir });
  const baseUrl = resolveBaseUrl(env);
  fs.mkdirSync(roots.central, { recursive: true });

  const results = [];
  for (const id of targetIds) {
    const item = CATALOG_MAP.get(id);
    const existing = readInstalledSkillInfo(id, roots);
    if (existing.installed && !force) {
      const linkStatus = link ? syncClientLink(path.join(roots.central, id), existing.linkPath, { force }) : "skipped";
      results.push({
        id,
        name: item.name,
        action: "already_installed",
        version: existing.version,
        dir: existing.dir,
        linkStatus,
      });
      continue;
    }
    const installed = await downloadAndInstallSkill(id, roots, { baseUrl, fetchImpl, link, force });
    results.push({ ...installed, action: existing.installed ? "reinstalled" : "installed" });
  }
  return { roots, results };
}

export async function updateSkills({
  ids = [],
  all = false,
  force = false,
  link = true,
  homeDir = os.homedir(),
  env = process.env,
  centralDir = null,
  linkDir = null,
  fetchImpl = fetch,
} = {}) {
  const roots = resolveSkillRoots({ homeDir, env, centralDir, linkDir });
  const baseUrl = resolveBaseUrl(env);
  const candidateIds = ids.length > 0
    ? resolveTargetIds({ ids })
    : SKILLHUB_CATALOG.map((item) => item.id).filter((id) => readInstalledSkillInfo(id, roots).installed);

  if (!candidateIds.length && !all) {
    return { roots, results: [], message: "No SkillHub skills installed yet." };
  }
  const targetIds = all && ids.length === 0 && !candidateIds.length
    ? resolveTargetIds({ all: true })
    : candidateIds;

  const results = [];
  for (const id of targetIds) {
    const item = CATALOG_MAP.get(id);
    const local = readInstalledSkillInfo(id, roots);
    if (!local.installed) {
      results.push({ id, name: item.name, action: "not_installed" });
      continue;
    }
    const remoteInfo = await fetchRemoteInfo(id, { baseUrl, fetchImpl });
    if (remoteInfo.error && !force) {
      results.push({ id, name: item.name, action: "check_failed", error: remoteInfo.error });
      continue;
    }
    const needsUpdate = force || hasRemoteUpdate(local, remoteInfo);
    if (!needsUpdate) {
      const linkStatus = link ? syncClientLink(local.dir, local.linkPath, { force }) : "skipped";
      results.push({
        id,
        name: item.name,
        action: "up_to_date",
        version: local.version,
        dir: local.dir,
        linkStatus,
      });
      continue;
    }
    const updated = await downloadAndInstallSkill(id, roots, { baseUrl, fetchImpl, link, force, remoteInfo });
    results.push({
      ...updated,
      previousVersion: local.version,
      action: "updated",
    });
  }
  return { roots, results };
}

export function removeSkills({
  ids = [],
  force = false,
  homeDir = os.homedir(),
  env = process.env,
  centralDir = null,
  linkDir = null,
} = {}) {
  const targetIds = resolveTargetIds({ ids });
  if (!targetIds.length) throw new Error("Specify skill ID(s) to remove.");
  const roots = resolveSkillRoots({ homeDir, env, centralDir, linkDir });

  const results = [];
  for (const id of targetIds) {
    const dir = path.join(roots.central, id);
    const linkPath = path.join(roots.antigravity, id);
    let linkRemoved = false;
    try {
      const st = fs.lstatSync(linkPath);
      if (st.isSymbolicLink() || force) {
        fs.rmSync(linkPath, { recursive: true, force: true });
        linkRemoved = true;
      }
    } catch {}

    let dirRemoved = false;
    if (fs.existsSync(dir)) {
      const hasMeta = fs.existsSync(path.join(dir, META_FILENAME));
      if (!hasMeta && !force) {
        results.push({ id, action: "skipped_unmanaged", dir, linkRemoved });
        continue;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      dirRemoved = true;
    }
    results.push({ id, action: dirRemoved || linkRemoved ? "removed" : "not_found", dirRemoved, linkRemoved });
  }
  return { roots, results };
}

async function downloadAndInstallSkill(id, roots, { baseUrl, fetchImpl, link, force, remoteInfo = null }) {
  const item = CATALOG_MAP.get(id);
  const info = remoteInfo || await fetchRemoteInfo(id, { baseUrl, fetchImpl });
  const zipUrl = `${baseUrl}/${id}.zip`;
  const resp = await fetchImpl(zipUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    throw new Error(`Failed to download ${zipUrl}: HTTP ${resp.status}`);
  }
  const zipBuffer = Buffer.from(await resp.arrayBuffer());
  const zipSha256 = sha256(zipBuffer);

  const stageDir = path.join(roots.central, `.${id}.tmp-${process.pid}-${Date.now()}`);
  const destDir = path.join(roots.central, id);
  try {
    extractZipBuffer(zipBuffer, stageDir, { stripPrefix: id });
    const skillMdPath = path.join(stageDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`Downloaded archive for ${id} does not contain SKILL.md.`);
    }
    const skillMdText = fs.readFileSync(skillMdPath, "utf8");
    const skillJson = readJsonSafe(path.join(stageDir, "skill.json"));
    const version = parseFrontmatterVersion(skillMdText) || skillJson?.version || info.version || null;
    const meta = {
      id,
      version,
      sourceUrl: zipUrl,
      etag: resp.headers.get("etag") || info.etag || null,
      lastModified: resp.headers.get("last-modified") || info.lastModified || null,
      zipSha256,
      skillMdSha256: sha256(skillMdText),
      remoteMarkdownSha256: info.markdownSha256 || null,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(stageDir, META_FILENAME), JSON.stringify(meta, null, 2) + "\n", "utf8");

    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(stageDir, destDir);
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }

  const linkPath = path.join(roots.antigravity, id);
  const linkStatus = link ? syncClientLink(destDir, linkPath, { force }) : "skipped";
  return {
    id,
    name: item.name,
    version: readJsonSafe(path.join(destDir, META_FILENAME))?.version || null,
    dir: destDir,
    linkPath: link ? linkPath : null,
    linkStatus,
  };
}

export async function fetchRemoteInfo(id, { baseUrl = DEFAULT_SKILLHUB_BASE_URL, fetchImpl = fetch } = {}) {
  const result = {
    version: null,
    markdownSha256: null,
    etag: null,
    lastModified: null,
    error: null,
  };
  try {
    const jsResp = await fetchImpl(`${baseUrl}/${id}.js`, { signal: AbortSignal.timeout(15000) });
    if (jsResp.ok) {
      const jsText = await jsResp.text();
      const parsed = parseSkillHubJs(jsText);
      if (parsed?.markdown) {
        result.version = parseFrontmatterVersion(parsed.markdown);
        result.markdownSha256 = sha256(parsed.markdown);
      }
    }
  } catch (error) {
    result.error = error?.message || "Failed to fetch remote skill metadata.";
  }

  try {
    const headResp = await fetchImpl(`${baseUrl}/${id}.zip`, {
      method: "HEAD",
      signal: AbortSignal.timeout(15000),
    });
    if (headResp.ok) {
      result.etag = headResp.headers.get("etag") || null;
      result.lastModified = headResp.headers.get("last-modified") || null;
    }
  } catch (error) {
    if (!result.error && !result.version) {
      result.error = error?.message || "Failed to probe remote archive.";
    }
  }
  return result;
}

export function parseSkillHubJs(text) {
  const raw = String(text || "");
  const assignMatch = /\bconst\s+skill\s*=\s*\{/.exec(raw);
  const start = assignMatch ? assignMatch.index + assignMatch[0].length - 1 : raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseFrontmatterVersion(markdown) {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const verMatch = match[1].match(/^version:\s*["']?(.+?)["']?\s*$/m);
  return verMatch ? verMatch[1].trim() : null;
}

function hasRemoteUpdate(local, remote) {
  if (remote.version && local.version && remote.version !== local.version) return true;
  if (remote.markdownSha256 && local.meta?.remoteMarkdownSha256) {
    if (remote.markdownSha256 !== local.meta.remoteMarkdownSha256) return true;
  }
  if (remote.etag && local.meta?.etag && remote.etag !== local.meta.etag) return true;
  if (!remote.etag && remote.lastModified && local.meta?.lastModified && remote.lastModified !== local.meta.lastModified) {
    return true;
  }
  return false;
}

function syncClientLink(centralSkillDir, linkPath, { force = false } = {}) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const resolvedCentral = path.resolve(centralSkillDir);
  let stat = null;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {}

  if (stat) {
    if (stat.isSymbolicLink()) {
      const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
      if (currentTarget === resolvedCentral) return "linked";
      fs.unlinkSync(linkPath);
    } else if (force || fs.existsSync(path.join(linkPath, META_FILENAME))) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      return "existing_unmanaged_kept";
    }
  }

  try {
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(resolvedCentral, linkPath, linkType);
    return "linked";
  } catch {
    fs.cpSync(resolvedCentral, linkPath, { recursive: true });
    return "copied";
  }
}

function inspectClientLink(centralSkillDir, linkPath) {
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const target = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
      return target === path.resolve(centralSkillDir) ? "linked" : "linked_other";
    }
    return "directory";
  } catch {
    return "missing";
  }
}

function resolveBaseUrl(env) {
  const override = String(env?.TDX_SKILLHUB_URL || "").trim();
  return (override || DEFAULT_SKILLHUB_BASE_URL).replace(/\/+$/, "");
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
