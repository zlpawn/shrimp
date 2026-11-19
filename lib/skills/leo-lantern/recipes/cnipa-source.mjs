#!/usr/bin/env node

/**
 * 中国专利公布公告 (CNIPA / epub.cnipa.gov.cn) 检索与文献事实探针 (Ground Truth Extractor)
 *
 * 核心设计原则：
 * 1. 真实浏览器上下文防拦截：复用 Leo Lantern 真实 Chrome 会话，在页面上下文执行 fetch 请求，
 *    自动由浏览器维护瑞数 WAF Cookie (NOh8RTWx6K2dS / NOh8RTWx6K2dT)、动态参数与 ASP.NET Core AntiForgeryToken。
 * 2. 100% 事实保真：完整提取公布/公告号、公布/公告日、申请号、申请日、申请人、发明人、地址、
 *    完整 IPC/LOC 分类号、专利代理机构与代理师、完整摘要、法律状态（事务数据）以及文献版本句柄。
 * 3. 无验证码逐页高清文献抓取：通过 egaz.cnipa.gov.cn/showPage 与 /imgs/ 拉取说明书每页高清 PNG，
 *    以及列表首图缩略图，统一落盘至 media/。
 * 4. 动态配置输出路径：CLI --out > ~/.shrimp/skills/leo-lantern/cnipa-source-config.json > 默认 (~/素材/patents)。
 */

import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../scripts/cli/index.mjs");
const BASE_URL = "http://epub.cnipa.gov.cn";
const EGAZ_URL = "http://egaz.cnipa.gov.cn";

const VALID_SORTS = new Set(["ggr_desc", "ggr_asc", "sqr_desc", "sqr_asc"]);
const VALID_MODES = new Set(["search", "advanced", "detail", "sw"]);
const PUBTYPE_MAP = {
  "1": "发明公布",
  "2": "发明公布更正",
  "3": "发明授权",
  "4": "发明授权更正",
  "6": "实用新型",
  "7": "实用新型更正",
  "9": "外观设计",
  "10": "外观设计更正"
};

// ==================== 配置与路径解析 ====================

export function getConfigPath() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "cnipa-source-config.json");
}

export function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (syncFs.existsSync(cfgPath)) {
      const raw = syncFs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(raw);
    }
  } catch {
    // 忽略读取异常
  }
  return {};
}

export function saveConfig(patch) {
  const cfgPath = getConfigPath();
  try {
    syncFs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const current = loadConfig();
    const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
    syncFs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  } catch (err) {
    console.warn("⚠️ 保存配置失败:", err.message);
    return null;
  }
}

export function resolveOutputDir(cliDir) {
  if (cliDir) {
    const resolved = path.resolve(cliDir);
    saveConfig({ output_dir: resolved });
    return resolved;
  }
  const cfg = loadConfig();
  if (cfg.output_dir) {
    return path.resolve(cfg.output_dir);
  }
  return path.join(os.homedir(), "素材", "patents");
}

// ==================== 参数解析与校验 ====================

export function normalizeCnipaDate(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[\\/\-]/g, ".");
  const compact = digits.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}.${compact[2]}.${compact[3]}`;
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(digits)) return digits;
  throw new Error(`日期格式无效 "${input}"，请使用 YYYY.MM.DD 或 YYYY-MM-DD`);
}

export function parsePatentTypes(raw) {
  const defaults = { fmgb: true, fmsq: true, xxsq: true, wgsq: true };
  if (!raw) return defaults;
  const tokens = String(raw)
    .split(/[,，]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return defaults;

  const result = { fmgb: false, fmsq: false, xxsq: false, wgsq: false };
  for (const t of tokens) {
    if (t === "all" || t === "全部") return defaults;
    if (t === "fmgb" || t === "发明公布") result.fmgb = true;
    else if (t === "fmsq" || t === "发明授权" || t === "发明专利") result.fmsq = true;
    else if (t === "xxsq" || t === "xx" || t === "实用新型") result.xxsq = true;
    else if (t === "wgsq" || t === "wg" || t === "外观设计") result.wgsq = true;
    else throw new Error(`不支持的专利类型 "${t}"，可选: fmgb, fmsq, xxsq, wgsq`);
  }
  if (!result.fmgb && !result.fmsq && !result.xxsq && !result.wgsq) {
    throw new Error("请至少选择一种专利类型");
  }
  return result;
}

export function parseCliArgs(argv) {
  const opts = {
    mode: "",
    query: "",
    title: "",
    abs: "",
    applicant: "",
    inventor: "",
    an: "",
    pn: "",
    ipc: "",
    address: "",
    agency: "",
    agent: "",
    adBegin: "",
    adEnd: "",
    pdBegin: "",
    pdEnd: "",
    ggrBegin: "",
    ggrEnd: "",
    typesRaw: "",
    pubtype: "",
    sort: "ggr_desc",
    limit: 10,
    pageSize: 10,
    deep: undefined,
    withThumb: false,
    downloadPages: undefined,
    maxPages: 0,
    skipMedia: false,
    delayMs: 3000,
    sliceDays: 0,
    sliceMonth: false,
    totalLimit: 0,
    dedupFile: "",
    swPubdate: "",
    swInfo: "",
    swType: "",
    outDir: "",
    setOut: "",
    getOut: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`参数 ${arg} 缺少值`);
      return argv[++i];
    };

    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--get-out") opts.getOut = true;
    else if (arg === "--set-out") opts.setOut = next();
    else if (arg === "--mode" || arg === "-m") opts.mode = next().toLowerCase();
    else if (arg === "--query" || arg === "-q") opts.query = next();
    else if (arg === "--title" || arg === "-t") opts.title = next();
    else if (arg === "--abs") opts.abs = next();
    else if (arg === "--applicant") opts.applicant = next();
    else if (arg === "--inventor") opts.inventor = next();
    else if (arg === "--an") opts.an = next();
    else if (arg === "--pn") opts.pn = next();
    else if (arg === "--url" || arg === "-u") {
      const u = next();
      const match = u.match(/\/patent\/([A-Za-z0-9]+)/i);
      if (!match) throw new Error(`无法从 URL 中识别专利公开号: ${u}`);
      opts.pn = match[1];
    } else if (arg === "--ipc") opts.ipc = next();
    else if (arg === "--address") opts.address = next();
    else if (arg === "--agency") opts.agency = next();
    else if (arg === "--agent") opts.agent = next();
    else if (arg === "--ad-begin") opts.adBegin = normalizeCnipaDate(next());
    else if (arg === "--ad-end") opts.adEnd = normalizeCnipaDate(next());
    else if (arg === "--pd-begin") opts.pdBegin = normalizeCnipaDate(next());
    else if (arg === "--pd-end") opts.pdEnd = normalizeCnipaDate(next());
    else if (arg === "--ggr-begin") opts.ggrBegin = normalizeCnipaDate(next());
    else if (arg === "--ggr-end") opts.ggrEnd = normalizeCnipaDate(next());
    else if (arg === "--types") opts.typesRaw = next();
    else if (arg === "--pubtype") opts.pubtype = next();
    else if (arg === "--sort") opts.sort = next().toLowerCase();
    else if (arg === "--limit" || arg === "-n") {
      const n = Number.parseInt(next(), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--limit 必须为正整数");
      opts.limit = n;
    } else if (arg === "--total-limit") {
      const n = Number.parseInt(next(), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--total-limit 必须为正整数");
      opts.totalLimit = n;
    } else if (arg === "--page-size") {
      const ps = Number.parseInt(next(), 10);
      if (ps !== 3 && ps !== 10) throw new Error("--page-size 仅支持 3 或 10");
      opts.pageSize = ps;
    } else if (arg === "--delay-ms") {
      const d = Number.parseInt(next(), 10);
      if (!Number.isFinite(d) || d < 0) throw new Error("--delay-ms 必须为非负整数");
      opts.delayMs = d;
    } else if (arg === "--slice-days") {
      const sd = Number.parseInt(next(), 10);
      if (!Number.isFinite(sd) || sd <= 0) throw new Error("--slice-days 必须为正整数");
      opts.sliceDays = sd;
    } else if (arg === "--slice-month") opts.sliceMonth = true;
    else if (arg === "--dedup-file" || arg === "--merge") opts.dedupFile = next();
    else if (arg === "--deep") opts.deep = true;
    else if (arg === "--no-deep") opts.deep = false;
    else if (arg === "--with-thumb") opts.withThumb = true;
    else if (arg === "--download-pages") opts.downloadPages = true;
    else if (arg === "--no-download-pages") opts.downloadPages = false;
    else if (arg === "--max-pages") {
      const mp = Number.parseInt(next(), 10);
      if (!Number.isFinite(mp) || mp <= 0) throw new Error("--max-pages 必须为正整数");
      opts.maxPages = mp;
    } else if (arg === "--skip-media" || arg === "--no-media") opts.skipMedia = true;
    else if (arg === "--sw-pubdate") opts.swPubdate = normalizeCnipaDate(next());
    else if (arg === "--sw-info") opts.swInfo = next();
    else if (arg === "--sw-type") opts.swType = next();
    else if (arg === "--out" || arg === "--out-dir" || arg === "-o") opts.outDir = next();
    else if (!arg.startsWith("-")) {
      if (/^https?:\/\/.*\/patent\/([A-Za-z0-9]+)/i.test(arg)) {
        opts.pn = arg.match(/\/patent\/([A-Za-z0-9]+)/i)[1];
      } else if (/^CN[0-9A-Z]+$/i.test(arg)) {
        opts.pn = arg.toUpperCase();
      } else if (!opts.query) {
        opts.query = arg;
      }
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (opts.help || opts.getOut || opts.setOut) {
    return opts;
  }

  if (!VALID_SORTS.has(opts.sort)) {
    throw new Error(`--sort 无效 "${opts.sort}"，可选: ${[...VALID_SORTS].join(", ")}`);
  }

  if (opts.pubtype && !PUBTYPE_MAP[opts.pubtype]) {
    throw new Error(`--pubtype 无效 "${opts.pubtype}"，可选: ${Object.keys(PUBTYPE_MAP).join(", ")}`);
  }

  opts.types = parsePatentTypes(opts.typesRaw);

  const hasAdvancedFields = Boolean(
    opts.title || opts.abs || opts.applicant || opts.inventor || opts.ipc ||
    opts.address || opts.agency || opts.agent ||
    opts.adBegin || opts.adEnd || opts.pdBegin || opts.pdEnd || opts.ggrBegin || opts.ggrEnd
  );
  const hasSwFields = Boolean(opts.swPubdate || opts.swInfo || opts.swType);

  if (!opts.mode) {
    if (hasSwFields) opts.mode = "sw";
    else if (hasAdvancedFields) opts.mode = "advanced";
    else if (opts.pn || (opts.an && !opts.query)) opts.mode = "detail";
    else opts.mode = "search";
  }

  if (!VALID_MODES.has(opts.mode)) {
    throw new Error(`--mode 无效 "${opts.mode}"，可选: ${[...VALID_MODES].join(", ")}`);
  }

  if (opts.mode === "search" && !opts.query) {
    throw new Error("search 模式需要提供检索关键词 (--query / -q)");
  }
  if (opts.mode === "advanced" && !hasAdvancedFields && !opts.an && !opts.pn) {
    throw new Error("advanced 模式请至少提供一个检索字段（如 --title, --applicant, --ipc, --an, --pn 等）");
  }
  if (opts.mode === "detail" && !opts.pn && !opts.an) {
    throw new Error("detail 模式需要提供公开(公告)号 (--pn) 或申请号 (--an)");
  }
  if (opts.mode === "sw" && !opts.an && !opts.swPubdate && !opts.swInfo) {
    throw new Error("sw 模式需要至少提供 --an、--sw-pubdate 或 --sw-info 之一");
  }

  if (opts.downloadPages === undefined) {
    opts.downloadPages = opts.mode === "detail" && !opts.skipMedia;
  }
  if (opts.skipMedia) {
    opts.downloadPages = false;
    opts.withThumb = false;
  } else if (opts.downloadPages) {
    opts.withThumb = true;
  }

  if (opts.deep === undefined) {
    opts.deep = opts.mode === "detail" || opts.downloadPages;
  }
  if (opts.downloadPages) {
    opts.deep = true;
  }

  if (opts.sliceDays > 0 || opts.sliceMonth) {
    const hasPair =
      (opts.pdBegin && opts.pdEnd) ||
      (opts.adBegin && opts.adEnd) ||
      (opts.ggrBegin && opts.ggrEnd);
    if (!hasPair) {
      throw new Error("时间切片 (--slice-days / --slice-month) 需要成对提供起止日期（如 --pd-begin 与 --pd-end，或 --ad-begin 与 --ad-end）");
    }
  }

  return opts;
}

// ==================== 节流、时间切片与增量去重辅助函数 ====================

export function computeJitterMs(baseMs, rng = Math.random) {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;
  return Math.round(baseMs * (1 + 0.6 * rng()));
}

function parseUtcDate(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!m) throw new Error(`无效日期格式: ${dateStr}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatUtcDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

export function splitDateRange(beginStr, endStr, sliceDays) {
  const start = parseUtcDate(beginStr);
  const end = parseUtcDate(endStr);
  if (start > end) throw new Error(`起始日期 ${beginStr} 不能晚于结束日期 ${endStr}`);
  const step = Math.max(1, Math.floor(sliceDays));
  const slices = [];
  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    const chunkEnd = new Date(cursor.getTime());
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + step - 1);
    const actualEnd = chunkEnd > end ? end : chunkEnd;
    slices.push({ begin: formatUtcDate(cursor), end: formatUtcDate(actualEnd) });
    cursor = new Date(actualEnd.getTime());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slices;
}

export function splitDateRangeByMonth(beginStr, endStr) {
  const start = parseUtcDate(beginStr);
  const end = parseUtcDate(endStr);
  if (start > end) throw new Error(`起始日期 ${beginStr} 不能晚于结束日期 ${endStr}`);
  const slices = [];
  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    const monthLast = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const actualEnd = monthLast > end ? end : monthLast;
    slices.push({ begin: formatUtcDate(cursor), end: formatUtcDate(actualEnd) });
    cursor = new Date(actualEnd.getTime());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slices;
}

export function buildDateSlices(opts) {
  const field =
    opts.pdBegin && opts.pdEnd ? "pd" :
    opts.adBegin && opts.adEnd ? "ad" :
    opts.ggrBegin && opts.ggrEnd ? "ggr" : null;

  if (!field || (!opts.sliceDays && !opts.sliceMonth)) {
    return [{ field: null, begin: "", end: "" }];
  }
  const begin = field === "pd" ? opts.pdBegin : field === "ad" ? opts.adBegin : opts.ggrBegin;
  const end = field === "pd" ? opts.pdEnd : field === "ad" ? opts.adEnd : opts.ggrEnd;
  const ranges = opts.sliceMonth
    ? splitDateRangeByMonth(begin, end)
    : splitDateRange(begin, end, opts.sliceDays);
  return ranges.map((r) => ({ field, begin: r.begin, end: r.end }));
}

export function getPatentDedupKey(item) {
  if (!item) return "";
  if (item.pn) return String(item.pn).trim().toUpperCase();
  const an = String(item.an || "").trim().toUpperCase();
  const dt = String(item.pd || item.sw_pubdate || item.sw_status || "").trim();
  return an ? `${an}_${dt}` : String(item.title || "").trim();
}

export function deduplicateAndMerge(newItems, existingItems = []) {
  const seen = new Set();
  const existing = [];
  for (const item of existingItems) {
    const key = getPatentDedupKey(item);
    if (key) seen.add(key);
    existing.push(item);
  }

  const added = [];
  let skippedDuplicates = 0;
  for (const item of newItems) {
    const key = getPatentDedupKey(item);
    if (key && seen.has(key)) {
      skippedDuplicates++;
      continue;
    }
    if (key) seen.add(key);
    added.push(item);
  }

  const merged = [...existing, ...added].map((item, idx) => ({ ...item, index: idx + 1 }));
  return { merged, added, skippedDuplicates };
}

// ==================== Payload 构造器 (可单测) ====================

export function buildIndexPayload(opts, token) {
  return {
    searchStr: opts.query,
    fmgb: opts.types.fmgb ? "true" : "false",
    fmsq: opts.types.fmsq ? "true" : "false",
    xxsq: opts.types.xxsq ? "true" : "false",
    wgsq: opts.types.wgsq ? "true" : "false",
    trsSql: "",
    __RequestVerificationToken: token
  };
}

export function buildAdvancedPayload(opts, token) {
  return {
    sortField: opts.sort,
    showMode: "1",
    pageSize: String(opts.pageSize || 10),
    pageNum: "1",
    isFmgb: opts.types.fmgb ? "true" : "false",
    isFmsq: opts.types.fmsq ? "true" : "false",
    isXx: opts.types.xxsq ? "true" : "false",
    isWg: opts.types.wgsq ? "true" : "false",
    "catalogInfo.Pn": opts.pn || "",
    "catalogInfo.Pd_Begin": opts.pdBegin || "",
    "catalogInfo.Pd_End": opts.pdEnd || "",
    "catalogInfo.Ggr_Begin": opts.ggrBegin || "",
    "catalogInfo.Ggr_End": opts.ggrEnd || "",
    "catalogInfo.An": opts.an || "",
    "catalogInfo.Edz": opts.address || "",
    "catalogInfo.Ad_Begin": opts.adBegin || "",
    "catalogInfo.Ad_End": opts.adEnd || "",
    "catalogInfo.E71_73": opts.applicant || "",
    "catalogInfo.E72": opts.inventor || "",
    "catalogInfo.E51": opts.ipc || "",
    "catalogInfo.Ti": opts.title || "",
    "catalogInfo.Abs": opts.abs || "",
    "catalogInfo.E74": opts.agency || "",
    "catalogInfo.Edl": opts.agent || "",
    "catalogInfo.E30": "",
    "catalogInfo.E66": "",
    "catalogInfo.E62": "",
    "catalogInfo.E83": "",
    "catalogInfo.E86": "",
    "catalogInfo.E87": "",
    "catalogInfo.E85": "",
    trsSql: "",
    __RequestVerificationToken: token
  };
}

export function buildSwListPayload(opts, token) {
  const clauses = [];
  if (opts.an) {
    let cleanAn = opts.an.replace(/\./g, "").trim();
    if (/^(?:8[5-9]|9[0-9]|0[0-3])[12389][0-9]{5}$|^20[0-9]{2}[12389][0-9]{7}$/.test(cleanAn)) {
      cleanAn += "%";
    } else if (!cleanAn.endsWith("%")) {
      cleanAn += "%";
    }
    clauses.push(`申请号='${cleanAn}'`);
  }
  if (opts.swPubdate) clauses.push(`法律状态公告日='${opts.swPubdate}'`);
  if (opts.swInfo) clauses.push(`法律状态信息='${opts.swInfo}'`);
  if (opts.swType && opts.swType !== "所有事物类型") clauses.push(`法律状态='${opts.swType}'`);

  return {
    sortField: "ggr_desc",
    pageSize: String(opts.pageSize || 10),
    pageNum: "1",
    "swInfo.SwType": opts.swType || "",
    "swInfo.PubType": "",
    isFmsq: opts.types.fmsq ? "true" : "false",
    isXx: opts.types.xxsq ? "true" : "false",
    isWg: opts.types.wgsq ? "true" : "false",
    "swInfo.An": opts.an || "",
    "swInfo.SwPubdate": opts.swPubdate || "",
    "swInfo.SwInfo": opts.swInfo || "",
    trsSql: clauses.join(" and "),
    __RequestVerificationToken: token
  };
}

// ==================== Leo Lantern CLI 交互封装 ====================

function runLantern(cmd, args = []) {
  const res = spawnSync("node", [CLI_PATH, cmd, ...args], { encoding: "utf8" });
  if (res.status !== 0) {
    try {
      return { ok: false, error: JSON.parse(res.stderr || res.stdout || "{}").error };
    } catch {
      return { ok: false, error: res.stderr || res.stdout };
    }
  }
  try {
    return JSON.parse(res.stdout || "{}");
  } catch {
    return { ok: true, output: res.stdout };
  }
}

function runLanternEval(code) {
  const tmpFile = path.join(os.tmpdir(), `cnipa_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
  try {
    syncFs.writeFileSync(tmpFile, code, "utf8");
    return runLantern("eval", ["--file", tmpFile]);
  } finally {
    try { syncFs.unlinkSync(tmpFile); } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTokenReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = runLanternEval(`(() => {
      const tok = document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
      return { ready: Boolean(tok), url: location.href, title: document.title, tokenLen: tok.length };
    })()`);
    if (res.ok && res.evalResult?.ready) return res.evalResult;
    await sleep(600);
  }
  return null;
}

/** Runs an async browser script in background inside the page to avoid the 8s eval_timeout. */
async function runPageJob(asyncScript, timeoutMs = 45000) {
  const expr = String(asyncScript).trim().replace(/;$/, "");
  const starter = `(() => {
    const __id = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    window.__cnipaJobs = window.__cnipaJobs || {};
    const __job = { done: false, result: null, error: null };
    window.__cnipaJobs[__id] = __job;
    Promise.resolve().then(() => (${expr}))
      .then((res) => { __job.done = true; __job.result = res; })
      .catch((err) => { __job.done = true; __job.error = err?.message || String(err); });
    return { __jobId: __id };
  })()`;

  const startRes = runLanternEval(starter);
  if (!startRes.ok) return startRes;

  const firstVal = startRes.evalResult;
  if (!firstVal || !firstVal.__jobId) {
    return startRes;
  }

  const jobId = firstVal.__jobId;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    const pollRes = runLanternEval(`(() => {
      const j = window.__cnipaJobs?.[${JSON.stringify(jobId)}];
      if (!j) return { missing: true };
      if (!j.done) return { done: false };
      delete window.__cnipaJobs[${JSON.stringify(jobId)}];
      return { done: true, result: j.result, error: j.error };
    })()`);
    if (!pollRes.ok) return pollRes;
    const val = pollRes.evalResult;
    if (val?.missing) {
      return { ok: false, error: "page_job_lost" };
    }
    if (val?.done) {
      if (val.error) return { ok: false, error: val.error };
      return { ok: true, evalResult: val.result };
    }
  }
  return { ok: false, error: `page_job_timeout (${timeoutMs}ms)` };
}

// ==================== 浏览器端执行脚本模板 ====================

function buildBrowserQueryScript(endpoint, payload, options = {}) {
  return `(async () => {
  const endpoint = ${JSON.stringify(endpoint)};
  const initialPayload = ${JSON.stringify(payload)};
  const requestedPubtype = ${JSON.stringify(options.pubtype || "")};
  const requestedSort = ${JSON.stringify(options.sort || "ggr_desc")};
  const requestedPageSize = ${JSON.stringify(String(options.pageSize || 10))};
  const limit = ${JSON.stringify(options.limit || 10)};
  const delayMs = ${JSON.stringify(options.delayMs ?? 3000)};
  const baseUrl = ${JSON.stringify(BASE_URL)};

  async function jitterWait() {
    if (!delayMs || delayMs <= 0) return;
    const ms = Math.round(delayMs * (1 + 0.6 * Math.random()));
    await new Promise((r) => setTimeout(r, ms));
  }

  function isBlockedStatus(status, html) {
    return status === 400 || status === 403 || status === 429 || status === 503 || status === 202 || !html || !html.trim();
  }

  const token = document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
  if (!token) return { ok: false, error: 'missing_verification_token' };
  initialPayload.__RequestVerificationToken = token;

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function cleanText(el) {
    return (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function extractResultMeta(doc) {
    const rawHtml = doc.documentElement?.innerHTML || '';
    const totalPageMatch = rawHtml.match(/total_page\\s*=\\s*(\\d+)/) || rawHtml.match(/total_item:\\s*(\\d+)/);
    const totalCountMatch = rawHtml.match(/sortReset(?:_Sw)?\\(\\s*'(\\d+)'\\s*\\)/);
    const tabs = [...doc.querySelectorAll('.overview-menu .j-select-item a')].map((a) => {
      const m = (a.getAttribute('onclick') || '').match(/change_type\\(\\s*(\\d+)/);
      return { pubtype: m ? m[1] : '', label: cleanText(a), active: a.classList.contains('curr') };
    }).filter((t) => t.pubtype);
    const lastAn = doc.getElementById('lastAn')?.value || '';
    const lastGgr = doc.getElementById('lastGgr')?.value || '';
    const lastAd = doc.getElementById('lastAd')?.value || '';
    return {
      totalPages: totalPageMatch ? Number(totalPageMatch[1]) : 0,
      totalCount: totalCountMatch ? Number(totalCountMatch[1]) : null,
      tabs,
      lastAn,
      lastGgr,
      lastAd
    };
  }

  function parseItemsFromDoc(doc) {
    const items = [...doc.querySelectorAll('.overview-default .item')];
    return items.map((item) => {
      const qr = item.querySelector('.qrcode');
      const pic = item.querySelector('img#pic_name');
      const titleEl = item.querySelector('h1.title');
      const rawTitle = cleanText(titleEl);
      const typeMatch = rawTitle.match(/^\\[([^\\]]+)\\]\\s*(.*)$/);

      const fields = {};
      const allInfo = item.querySelector('.allinfo');
      const extraIpc = [];
      const extraMeta = {};
      let agency = '';
      let agent = '';
      if (allInfo) {
        const children = [...allInfo.querySelectorAll('dt, dd')];
        let lastLabel = '';
        for (const node of children) {
          if (node.tagName === 'DT') {
            lastLabel = cleanText(node).replace(/[：:]$/, '');
          } else if (node.tagName === 'DD') {
            const val = cleanText(node);
            if (!lastLabel) {
              if (val) extraIpc.push(val);
            } else if (lastLabel.includes('代理机构')) {
              agency = val;
            } else if (lastLabel.includes('代理师') || lastLabel.includes('代理人')) {
              agent = val;
            } else if (val) {
              extraMeta[lastLabel] = val;
            }
          }
        }
      }

      for (const dl of [...item.querySelectorAll('.info > dl, .intro > dl')]) {
        const dt = dl.querySelector('dt');
        const dd = dl.querySelector('dd');
        if (!dt || !dd) continue;
        const label = cleanText(dt).replace(/[：:]$/, '');
        const clone = dd.cloneNode(true);
        clone.querySelectorAll('.allinfo, a.open').forEach((n) => n.remove());
        if (label === '分类号') {
          const firstIpc = cleanText(clone);
          const list = [firstIpc, ...extraIpc].join(' ').split(/[;；]/).map((s) => s.trim()).filter(Boolean);
          fields.ipc = list;
        } else if (label === '摘要' || label === '简要说明') {
          fields.abstract = cleanText(clone);
        } else {
          fields[label] = cleanText(clone);
        }
      }

      const actions = [...item.querySelectorAll('a[onclick]')].map((a) => {
        const oc = a.getAttribute('onclick') || '';
        const m = oc.match(/(zl_xm|zl_PatentDetail)\\(\\s*'([^']*)'\\s*,\\s*'([^']*)'\\s*,\\s*'([^']*)'\\s*\\)/);
        if (!m) return null;
        return { fn: m[1], text: cleanText(a), anToken: m[2], pubType: m[3], ggr: m[4] };
      }).filter(Boolean);

      const pn = fields['申请公布号'] || fields['授权公告号'] || fields['公告号'] || qr?.id || '';
      const pd = fields['申请公布日'] || fields['授权公告日'] || fields['公告日'] || '';
      const thumbSrc = pic?.getAttribute('src') || '';
      const thumbUrl = thumbSrc ? new URL(thumbSrc, baseUrl + '/Dxb/').href : '';

      return {
        patent_type: typeMatch ? typeMatch[1] : '',
        title: typeMatch ? typeMatch[2] : rawTitle,
        pn,
        pd,
        an: fields['申请号'] || '',
        ad: fields['申请日'] || '',
        applicant: fields['申请人'] || fields['专利权人'] || fields['申请（专利权）人'] || '',
        inventor: fields['发明人'] || fields['设计人'] || fields['发明（设计）人'] || '',
        address: fields['地址'] || '',
        ipc: fields.ipc || [],
        agency,
        agent,
        extra_meta: Object.keys(extraMeta).length > 0 ? extraMeta : undefined,
        abstract: fields.abstract || '',
        detail_url: pn ? (baseUrl + '/patent/' + pn) : '',
        thumb_url: thumbUrl,
        detail_handle: actions[0] || null,
        sw_handle: actions.find((a) => a.text.includes('事务')) || actions[0] || null
      };
    });
  }

  function serializeForm(formEl) {
    const params = new URLSearchParams();
    if (!formEl) return params;
    for (const input of formEl.querySelectorAll('input')) {
      if (input.name) params.append(input.name, input.value || '');
    }
    return params;
  }

  async function postForm(url, paramsObj) {
    const body = paramsObj instanceof URLSearchParams ? paramsObj.toString() : new URLSearchParams(paramsObj).toString();
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    });
    const html = await res.text();
    return { status: res.status, html };
  }

  const firstRes = await postForm(endpoint, initialPayload);
  if (firstRes.status >= 400 || firstRes.status === 202 || !firstRes.html.trim()) {
    return {
      ok: false,
      blocked: firstRes.status === 400 || firstRes.status === 403 || firstRes.status === 429 || firstRes.status === 202,
      status: firstRes.status,
      error: 'HTTP ' + firstRes.status + ' on ' + endpoint
    };
  }

  const firstDoc = parseHtml(firstRes.html);
  const queryForm = firstDoc.getElementById('query_form');
  const nextToken = queryForm?.querySelector('input[name="__RequestVerificationToken"]')?.value || token;
  let meta = extractResultMeta(firstDoc);
  let items = parseItemsFromDoc(firstDoc);
  let circuitBroken = false;
  let breakReason = '';

  const formParams = serializeForm(queryForm);
  const currentPubtype = formParams.get('searchCatalogInfo.Pubtype') || '';
  const currentSort = formParams.get('sortFiled') || 'ggr_desc';
  const needSwitchPage1 =
    Boolean(queryForm) && (
      (requestedPubtype && requestedPubtype !== currentPubtype) ||
      (requestedSort !== currentSort)
    );
  const needPageQuery =
    Boolean(queryForm) && (
      needSwitchPage1 ||
      (items.length === 0 && meta.tabs.length > 0) ||
      items.length < limit
    );

  if (needPageQuery && queryForm) {
    let targetPubtype = requestedPubtype || currentPubtype;
    if (!requestedPubtype && items.length === 0 && meta.tabs.length > 0) {
      for (const tab of meta.tabs) {
        await jitterWait();
        formParams.set('searchCatalogInfo.Pubtype', tab.pubtype);
        formParams.set('pageModel.pageNum', '1');
        formParams.set('pageModel.pageSize', requestedPageSize);
        formParams.set('sortFiled', requestedSort);
        formParams.set('showModel', '1');
        formParams.set('searchAfter', '');
        const probeRes = await postForm('/Dxb/PageQuery', formParams);
        if (isBlockedStatus(probeRes.status, probeRes.html)) {
          circuitBroken = true;
          breakReason = 'HTTP ' + probeRes.status + ' on /Dxb/PageQuery';
          break;
        }
        if (probeRes.status === 200) {
          const probeDoc = parseHtml(probeRes.html);
          const probeItems = parseItemsFromDoc(probeDoc);
          if (probeItems.length > 0) {
            targetPubtype = tab.pubtype;
            items = probeItems;
            meta = { ...meta, ...extractResultMeta(probeDoc) };
            break;
          }
        }
      }
    } else if (
      needSwitchPage1 ||
      (items.length < limit && requestedPageSize !== (formParams.get('pageModel.pageSize') || '3'))
    ) {
      await jitterWait();
      formParams.set('searchCatalogInfo.Pubtype', targetPubtype);
      formParams.set('pageModel.pageNum', '1');
      formParams.set('pageModel.pageSize', requestedPageSize);
      formParams.set('sortFiled', requestedSort);
      formParams.set('showModel', '1');
      formParams.set('searchAfter', '');
      const p1Res = await postForm('/Dxb/PageQuery', formParams);
      if (isBlockedStatus(p1Res.status, p1Res.html)) {
        circuitBroken = true;
        breakReason = 'HTTP ' + p1Res.status + ' on /Dxb/PageQuery';
      } else if (p1Res.status === 200) {
        const p1Doc = parseHtml(p1Res.html);
        const p1Items = parseItemsFromDoc(p1Doc);
        if (p1Items.length > 0) {
          items = p1Items;
          meta = { ...meta, ...extractResultMeta(p1Doc) };
        }
      }
    }

    let pageNum = 1;
    while (!circuitBroken && items.length < limit && meta.totalPages > pageNum) {
      await jitterWait();
      const sortVal = requestedSort.startsWith('ggr') ? meta.lastGgr : meta.lastAd;
      const searchAfter = (sortVal || meta.lastAn) ? (sortVal + ';' + meta.lastAn) : '';
      pageNum += 1;
      formParams.set('searchCatalogInfo.Pubtype', targetPubtype);
      formParams.set('pageModel.pageNum', String(pageNum));
      formParams.set('pageModel.pageSize', requestedPageSize);
      formParams.set('sortFiled', requestedSort);
      formParams.set('showModel', '1');
      formParams.set('searchAfter', searchAfter);

      const pageRes = await postForm('/Dxb/PageQuery', formParams);
      if (isBlockedStatus(pageRes.status, pageRes.html)) {
        circuitBroken = true;
        breakReason = 'HTTP ' + pageRes.status + ' on /Dxb/PageQuery (page ' + pageNum + ')';
        break;
      }
      if (pageRes.status !== 200) break;
      const pageDoc = parseHtml(pageRes.html);
      const pageItems = parseItemsFromDoc(pageDoc);
      if (pageItems.length === 0) break;
      items.push(...pageItems);
      meta = { ...meta, ...extractResultMeta(pageDoc) };
    }
  }

  return {
    ok: true,
    token: nextToken,
    totalCount: meta.totalCount,
    totalPages: meta.totalPages,
    tabs: meta.tabs,
    circuitBroken,
    breakReason,
    items: items.slice(0, limit)
  };
})()`;
}

function buildBrowserSwListScript(payload, options = {}) {
  return `(async () => {
  const payload = ${JSON.stringify(payload)};
  const limit = ${JSON.stringify(options.limit || 10)};
  const pageSize = ${JSON.stringify(String(options.pageSize || 10))};
  const delayMs = ${JSON.stringify(options.delayMs ?? 3000)};

  async function jitterWait() {
    if (!delayMs || delayMs <= 0) return;
    const ms = Math.round(delayMs * (1 + 0.6 * Math.random()));
    await new Promise((r) => setTimeout(r, ms));
  }

  const token = document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
  if (!token) return { ok: false, error: 'missing_verification_token' };
  payload.__RequestVerificationToken = token;

  function cleanText(el) {
    return (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function parseRows(doc) {
    return [...doc.querySelectorAll('table tbody tr')].map((tr) => {
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length < 4) return null;
      const link = tds[1].querySelector('a[onclick]');
      const oc = link?.getAttribute('onclick') || '';
      const m = oc.match(/zl_xm\\(\\s*'([^']*)'\\s*,\\s*'([^']*)'\\s*,\\s*'([^']*)'\\s*\\)/);
      return {
        seq_no: cleanText(tds[0]),
        an: cleanText(tds[1]),
        sw_pubdate: cleanText(tds[2]),
        sw_status: cleanText(tds[3]),
        sw_handle: m ? { anToken: m[1], pubType: m[2], ggr: m[3] } : null
      };
    }).filter(Boolean);
  }

  const res = await fetch('/SW/SwListQuery', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(payload).toString()
  });
  const html = await res.text();
  if (res.status >= 400 || res.status === 202 || !html.trim()) {
    return {
      ok: false,
      blocked: res.status === 400 || res.status === 403 || res.status === 429 || res.status === 202,
      status: res.status,
      error: 'HTTP ' + res.status + ' on /SW/SwListQuery'
    };
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = parseRows(doc);

  const queryForm = doc.getElementById('query_form');
  const nextToken = queryForm?.querySelector('input[name="__RequestVerificationToken"]')?.value || token;
  const totalMatch = html.match(/total_page\\s*=\\s*(\\d+)/);
  const totalPages = totalMatch ? Number(totalMatch[1]) : 1;
  let circuitBroken = false;
  let breakReason = '';

  if (queryForm && rows.length < limit && totalPages > 1) {
    const formParams = new URLSearchParams();
    for (const input of queryForm.querySelectorAll('input')) {
      if (input.name) formParams.append(input.name, input.value || '');
    }
    let pageNum = 1;
    while (rows.length < limit && pageNum < totalPages) {
      await jitterWait();
      pageNum += 1;
      formParams.set('pageModel.pageNum', String(pageNum));
      formParams.set('pageModel.pageSize', pageSize);
      const pRes = await fetch('/SW/SWPageQuery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: formParams.toString()
      });
      const pHtml = await pRes.text();
      if (pRes.status === 400 || pRes.status === 403 || pRes.status === 429 || pRes.status === 503 || pRes.status === 202 || !pHtml.trim()) {
        circuitBroken = true;
        breakReason = 'HTTP ' + pRes.status + ' on /SW/SWPageQuery';
        break;
      }
      if (!pRes.ok) break;
      const pDoc = new DOMParser().parseFromString(pHtml, 'text/html');
      const pRows = parseRows(pDoc);
      if (pRows.length === 0) break;
      rows.push(...pRows);
    }
  }

  return { ok: true, token: nextToken, totalPages, circuitBroken, breakReason, rows: rows.slice(0, limit) };
})()`;
}

function buildBrowserSwDetailScript(handle, token) {
  return `(async () => {
  const handle = ${JSON.stringify(handle)};
  const tok = ${JSON.stringify(token || "")} || document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
  if (!tok) return { ok: false, error: 'missing_verification_token' };

  const res = await fetch('/Sw/SwDetail', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({
      an: handle.anToken,
      pubType: handle.pubType || '3',
      ggr: handle.ggr || '',
      __RequestVerificationToken: tok
    }).toString()
  });
  const html = await res.text();
  if (res.status === 400 || res.status === 403 || res.status === 429 || res.status === 503 || res.status === 202 || !html.trim()) {
    return { ok: false, blocked: true, status: res.status, error: 'HTTP ' + res.status + ' on /Sw/SwDetail' };
  }
  if (!res.ok) return { ok: false, status: res.status, error: 'HTTP ' + res.status };
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const versions = [...doc.querySelectorAll('.apply-menu input[type="hidden"]')].map((inp) => {
    const link = doc.getElementById('dxb_' + inp.id);
    return {
      id: inp.id,
      label: clean(link),
      an: inp.dataset.an || '',
      ifs: inp.dataset.ifs || '',
      pdf: inp.dataset.pdf || ''
    };
  });

  const seqLinks = [...doc.querySelectorAll('.apply-menu a[id^="xlb"]')].map((a) => ({
    id: a.id,
    label: clean(a),
    seq: a.dataset.seq || ''
  }));

  const transactions = [...doc.querySelectorAll('#sw_view .info .item')].map((item) => {
    const obj = {};
    for (const dl of [...item.querySelectorAll('dl')]) {
      const k = clean(dl.querySelector('dt')).replace(/[：:]$/, '');
      const v = clean(dl.querySelector('dd'));
      if (k) obj[k] = v;
    }
    const status = clean(item.querySelector('.status'));
    return {
      sw_type: obj['事务数据类型'] || '',
      sw_pubdate: obj['事务数据公告日'] || '',
      status,
      extra: obj
    };
  });

  return {
    ok: true,
    detail_title: clean(doc.querySelector('#sw_view .top .title')),
    versions,
    seqLinks,
    transactions
  };
})()`;
}

// ==================== egaz 文献页面图片抓取 (无需验证码) ====================

async function downloadFile(url, destPath, referer) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        ...(referer ? { Referer: referer } : {})
      }
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    const ct = res.headers.get("content-type") || "";
    if (ct && !ct.startsWith("image/") && !ct.includes("octet-stream")) {
      return { ok: false, error: `Unexpected content-type: ${ct}` };
    }
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const stream = syncFs.createWriteStream(destPath);
    await pipeline(Readable.fromWeb(res.body), stream);
    const stat = await fs.stat(destPath);
    return { ok: true, size: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildBrowserFetchImageScript(imageUrl) {
  return `(async () => {
  const res = await fetch(${JSON.stringify(imageUrl)}, { credentials: 'same-origin' });
  if (!res.ok) {
    return {
      ok: false,
      blocked: res.status === 400 || res.status === 403 || res.status === 429 || res.status === 202,
      status: res.status
    };
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) return { ok: false, error: 'not_image:' + ct };
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { ok: true, contentType: ct, base64: btoa(bin) };
})()`;
}

async function fetchSpecificationPages(ifsHandle, destDir, maxPages = 0, delayMs = 400) {
  const downloaded = [];
  const encodedPath = ifsHandle.includes("%") ? ifsHandle : encodeURIComponent(ifsHandle);
  const firstPageRes = await fetch(`${EGAZ_URL}/showPage?path=${encodedPath}&page=1`);
  if (!firstPageRes.ok) return { totalPages: 0, downloaded };

  const firstData = await firstPageRes.json();
  const totalPages = Number.parseInt(firstData.pdfNum || "0", 10) || 0;
  if (!firstData.pdfPath || totalPages <= 0) return { totalPages, downloaded };

  const limitPages = maxPages > 0 ? Math.min(totalPages, maxPages) : totalPages;
  for (let p = 1; p <= limitPages; p++) {
    if (p > 1 && delayMs > 0) await sleep(computeJitterMs(Math.min(delayMs, 600)));
    let pageData = p === 1 ? firstData : null;
    if (!pageData) {
      const pRes = await fetch(`${EGAZ_URL}/showPage?path=${encodedPath}&page=${p}`);
      if (!pRes.ok) break;
      pageData = await pRes.json();
    }
    if (!pageData?.pdfPath) break;
    const imgUrl = `${EGAZ_URL}/imgs/${pageData.pdfPath}`;
    const ext = path.extname(pageData.pdfPath) || ".png";
    const fileName = `page_${String(p).padStart(3, "0")}${ext}`;
    const destPath = path.join(destDir, fileName);
    const dl = await downloadFile(imgUrl, destPath, `${EGAZ_URL}/showpdf`);
    if (dl.ok) {
      downloaded.push({ page: p, file_name: fileName, file_path: destPath, size_bytes: dl.size, url: imgUrl });
    }
  }
  return { totalPages, downloaded };
}

// ==================== Markdown 报告生成 ====================

export function generateMarkdown(data) {
  const lines = [
    `# 中国专利公布公告检索事实档案 (${data.target})`,
    "",
    `> **抓取时间**：${data.fetched_at}  `,
    `> **检索模式**：${data.mode} ${data.total_count !== null && data.total_count !== undefined ? `| **命中总数**：${data.total_count} 条` : ""}  `,
    `> **本次收录**：${data.patents.length} 条 | **本地媒体文件**：${data.total_media_files} 个${data.circuit_broken ? ` | **风控熔断**：是（${data.circuit_break_reason || "已保底保存"}）` : ""}  `,
    "",
    "---",
    ""
  ];

  for (const item of data.patents) {
    lines.push(`## ${String(item.index).padStart(2, "0")}. ${item.patent_type ? `[${item.patent_type}] ` : ""}${item.title || item.pn || item.an}`);
    lines.push("");
    if (item.pn) lines.push(`- **公布（公告）号**：\`${item.pn}\` ${item.detail_url ? `([直达链接](${item.detail_url}))` : ""}`);
    if (item.pd) lines.push(`- **公布（公告）日**：${item.pd}`);
    if (item.an) lines.push(`- **申请号**：\`${item.an}\``);
    if (item.ad) lines.push(`- **申请日**：${item.ad}`);
    if (item.applicant) lines.push(`- **申请人/专利权人**：${item.applicant}`);
    if (item.inventor) lines.push(`- **发明/设计人**：${item.inventor}`);
    if (item.address) lines.push(`- **地址**：${item.address}`);
    if (item.ipc && item.ipc.length > 0) lines.push(`- **分类号**：${item.ipc.join("; ")}`);
    if (item.agency) lines.push(`- **专利代理机构**：${item.agency}${item.agent ? `（代理师：${item.agent}）` : ""}`);
    if (item.abstract) {
      lines.push("");
      lines.push("### 摘要 / 简要说明");
      lines.push("");
      lines.push(item.abstract);
    }
    if (item.transactions && item.transactions.length > 0) {
      lines.push("");
      lines.push("### 事务数据 / 法律状态");
      lines.push("");
      for (const tx of item.transactions) {
        lines.push(`- **${tx.sw_pubdate || "-"}** | ${tx.sw_type || tx.status || "-"}`);
      }
    }
    if (item.spec_pages_total) {
      lines.push("");
      lines.push(`- **说明书全文页数**：${item.spec_pages_total} 页（已下载 ${item.downloaded_pages?.length || 0} 页）`);
    }
    if (item.thumb_file) {
      lines.push(`- **缩略图**：[\`${item.thumb_file.file_name}\`](./${item.thumb_file.relative_path})`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function sanitizeFilename(str) {
  return String(str || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim();
}

function printHelp() {
  console.log(`
中国专利公布公告 (CNIPA / epub.cnipa.gov.cn) 检索与文献事实探针

用法:
  node recipes/cnipa-source.mjs [选项] [关键词 或 公布号]

模式与核心选项:
  --mode, -m <search|advanced|detail|sw>   采集模式 (自动推断，默认 search)
  --query, -q <keyword>                    首页全字段快捷检索关键词
  --title, -t <text>                       发明/设计名称 (catalogInfo.Ti)
  --abs <text>                             摘要/简要说明 (catalogInfo.Abs)
  --applicant <text>                       申请（专利权）人 (catalogInfo.E71_73)
  --inventor <text>                        发明（设计）人 (catalogInfo.E72)
  --an <appNo>                             申请号 (catalogInfo.An / swInfo.An)
  --pn <pubNo>                             公布（公告）号 (如 CN123115842A)
  --url, -u <link>                         直接传入公布公告详情链接 (http://epub.cnipa.gov.cn/patent/...)
  --ipc <classNo>                          分类号 (catalogInfo.E51)
  --address <text>                         地址 (catalogInfo.Edz)
  --agency <text>                          专利代理机构 (catalogInfo.E74)
  --agent <text>                           专利代理师 (catalogInfo.Edl)
  --ad-begin / --ad-end <YYYY.MM.DD>       申请日起止日期
  --pd-begin / --pd-end <YYYY.MM.DD>       公布（公告）日起止日期
  --ggr-begin / --ggr-end <YYYY.MM.DD>     专利文献出版日起止日期
  --types <list>                           专利类型: fmgb,fmsq,xxsq,wgsq (默认全部)
  --pubtype <id>                           结果页类型切换 (1发明公布/3发明授权/6实用新型/9外观设计等)
  --sort <ggr_desc|ggr_asc|sqr_desc|sqr_asc> 排序方式 (默认: ggr_desc)
  --limit, -n <num>                        单次/每切片抓取条目上限 (默认: 10)
  --total-limit <num>                      时间切片模式下的总条目上限 (默认不限)
  --page-size <3|10>                       单页条数 (默认: 10)
  --delay-ms <ms>                          请求基础节流间隔毫秒数，实际附带 1.0~1.6x 随机抖动 (默认: 3000)
  --slice-days <days>                      按天数将日期区间切片分批抓取 (需配合起止日期参数)
  --slice-month                            按自然月将日期区间切片分批抓取 (需配合起止日期参数)
  --dedup-file, --merge <path>             增量去重并合并回写到指定 JSON 文件或目录
  --deep / --no-deep                       是否抓取每条专利的事务数据与文献全文句柄
  --with-thumb                             额外下载列表首图缩略图 (默认仅在 detail 或 --download-pages 时开启)
  --download-pages / --no-download-pages   无验证码抓取说明书每页高清 PNG 至 media/ (detail 模式默认开启)
  --max-pages <num>                        每条专利最多下载的说明书页数 (默认不限)
  --skip-media, --no-media                 跳过所有媒体文件下载
  --sw-pubdate <YYYY.MM.DD>                事务数据公告日 (sw 模式)
  --sw-info <text>                         法律状态信息 (sw 模式)
  --sw-type <text>                         法律状态类型 (sw 模式)
  --out, --out-dir, -o <path>              指定输出目录 (持久化至 cnipa-source-config.json)
  --set-out <path>                         单独持久化设置默认输出目录并退出
  --get-out                                查看当前配置的持久化输出目录
  --help, -h                               显示帮助

示例:
  node recipes/cnipa-source.mjs --query "人工智能" --limit 10
  node recipes/cnipa-source.mjs --mode advanced --applicant "华为技术有限公司" --title "大模型" --limit 5
  node recipes/cnipa-source.mjs --mode detail --pn CN123115842A --download-pages
  node recipes/cnipa-source.mjs --mode sw --an 2024115380488
`);
}

// ==================== 主流程 ====================

function resolveDedupJsonPath(rawPath) {
  const resolved = path.resolve(rawPath);
  if (syncFs.existsSync(resolved) && syncFs.statSync(resolved).isDirectory()) {
    return path.join(resolved, "专利事实.json");
  }
  if (!resolved.endsWith(".json")) {
    return path.join(resolved, "专利事实.json");
  }
  return resolved;
}

function loadExistingPatents(dedupJsonPath) {
  if (!dedupJsonPath || !syncFs.existsSync(dedupJsonPath)) return [];
  try {
    const parsed = JSON.parse(syncFs.readFileSync(dedupJsonPath, "utf8").replace(/^\uFEFF/, ""));
    return Array.isArray(parsed?.patents) ? parsed.patents : [];
  } catch (err) {
    console.warn(`⚠️ 读取已有去重文件失败 (${dedupJsonPath})，将按空集合处理: ${err.message}`);
    return [];
  }
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    console.error(`❌ 参数错误: ${err.message}`);
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (opts.getOut) {
    const cfg = loadConfig();
    console.log(`当前持久化输出目录: ${cfg.output_dir || `未设置 (默认使用 ${path.join(os.homedir(), "素材", "patents")})`}`);
    process.exit(0);
  }
  if (opts.setOut) {
    const saved = saveConfig({ output_dir: path.resolve(opts.setOut) });
    console.log(`✅ 已持久化配置默认输出目录: ${saved.output_dir}`);
    process.exit(0);
  }

  const dedupJsonPath = opts.dedupFile ? resolveDedupJsonPath(opts.dedupFile) : "";
  const existingPatents = dedupJsonPath ? loadExistingPatents(dedupJsonPath) : [];
  if (dedupJsonPath) {
    console.log(`🧩 增量去重模式：已加载历史记录 ${existingPatents.length} 条 (${dedupJsonPath})`);
  }

  const baseOutDir = resolveOutputDir(opts.outDir);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const slugSource = opts.pn || opts.an || opts.query || opts.title || opts.applicant || opts.ipc || opts.swInfo || opts.mode;
  const sessionDir = path.join(baseOutDir, `${dateStr}_${timeStr}_${opts.mode}_${sanitizeFilename(slugSource).slice(0, 40)}`);
  const mediaDir = path.join(sessionDir, "media");
  await fs.mkdir(mediaDir, { recursive: true });
  console.log(`📂 本次 CNIPA 事实落盘目录: ${sessionDir}`);

  console.log("\n🔌 正在连接 Leo Lantern Chrome 服务...");
  const startRes = runLantern("start");
  if (!startRes.ok && !startRes.bridge) {
    console.error("❌ 无法连接到 Leo Lantern 服务，请确认 Chrome 已打开并加载扩展。");
    process.exit(1);
  }

  const taskRes = runLantern("start-task", ["--title", "cnipa-source", "--same-window"]);
  if (!taskRes.ok) {
    console.error("❌ 创建 Lantern 任务失败:", taskRes.error);
    process.exit(1);
  }

  let patents = [];
  let totalCount = null;
  let totalPages = 0;
  let circuitBroken = false;
  let circuitBreakReason = "";

  const slices = buildDateSlices(opts);
  const perPageDelayBudget = Math.ceil(opts.limit / (opts.pageSize || 10)) * (opts.delayMs * 1.6 + 8000);
  const jobTimeoutMs = Math.max(45000, perPageDelayBudget + 30000);

  try {
    const entryUrl =
      opts.mode === "search" ? `${BASE_URL}/` :
      opts.mode === "sw" ? `${BASE_URL}/SW` :
      `${BASE_URL}/Advanced`;

    console.log(`🌐 正在打开入口页等待会话就绪: ${entryUrl}`);
    const gotoRes = runLantern("goto", [entryUrl]);
    if (!gotoRes.ok) {
      throw new Error(`导航失败: ${JSON.stringify(gotoRes.error || gotoRes)}`);
    }

    const ready = await waitForTokenReady(20000);
    if (!ready) {
      throw new Error("等待页面 __RequestVerificationToken 超时（可能仍处于瑞数校验页或网络异常）");
    }

    let currentToken = "";

    if (opts.mode === "sw") {
      console.log("🔍 正在执行事务（法律状态）查询...");
      const swPayload = buildSwListPayload(opts, "");
      const swRes = await runPageJob(buildBrowserSwListScript(swPayload, opts), jobTimeoutMs);
      if (!swRes.ok || !swRes.evalResult?.ok) {
        throw new Error(`事务查询失败: ${swRes.evalResult?.error || JSON.stringify(swRes.error)}`);
      }
      currentToken = swRes.evalResult.token || "";
      totalPages = swRes.evalResult.totalPages || 0;
      if (swRes.evalResult.circuitBroken) {
        circuitBroken = true;
        circuitBreakReason = swRes.evalResult.breakReason || "分页触发风控熔断";
        console.warn(`⚠️ ${circuitBreakReason}，保留已抓取列表继续处理`);
      }
      const rows = swRes.evalResult.rows || [];
      console.log(`📊 命中事务记录 ${rows.length} 条`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let detail = null;
        if (opts.deep && row.sw_handle && !circuitBroken) {
          if (i > 0 && opts.delayMs > 0) await sleep(computeJitterMs(opts.delayMs));
          console.log(`  [${i + 1}/${rows.length}] 正在获取事务详情: ${row.an}`);
          const dRes = await runPageJob(buildBrowserSwDetailScript(row.sw_handle, currentToken));
          if (dRes.ok && dRes.evalResult?.ok) {
            detail = dRes.evalResult;
          } else if (dRes.evalResult?.blocked) {
            circuitBroken = true;
            circuitBreakReason = dRes.evalResult.error || "事务详情触发风控熔断";
            console.warn(`⚠️ ${circuitBreakReason}，立即熔断并保底落盘已抓取结果`);
          }
        }
        patents.push({
          index: i + 1,
          an: row.an,
          title: detail?.detail_title || "",
          sw_pubdate: row.sw_pubdate,
          sw_status: row.sw_status,
          transactions: detail?.transactions || [{ sw_pubdate: row.sw_pubdate, sw_type: row.sw_status, status: row.sw_status }],
          versions: detail?.versions || [],
          seqLinks: detail?.seqLinks || []
        });
      }
    } else {
      const endpoint = opts.mode === "search" ? "/Dxb/IndexQuery" : "/Dxb/AdvancedQuery";
      const collectedRaw = [];

      for (let sIdx = 0; sIdx < slices.length; sIdx++) {
        if (circuitBroken) break;
        if (opts.totalLimit > 0 && collectedRaw.length >= opts.totalLimit) break;

        const slice = slices[sIdx];
        const sliceOpts = { ...opts };
        if (slice.field === "pd") {
          sliceOpts.pdBegin = slice.begin;
          sliceOpts.pdEnd = slice.end;
        } else if (slice.field === "ad") {
          sliceOpts.adBegin = slice.begin;
          sliceOpts.adEnd = slice.end;
        } else if (slice.field === "ggr") {
          sliceOpts.ggrBegin = slice.begin;
          sliceOpts.ggrEnd = slice.end;
        }
        if (opts.totalLimit > 0) {
          sliceOpts.limit = Math.min(opts.limit, opts.totalLimit - collectedRaw.length);
        }

        if (sIdx > 0 && opts.delayMs > 0) {
          const waitMs = computeJitterMs(opts.delayMs);
          console.log(`⏳ 切片节流等待 ${waitMs}ms...`);
          await sleep(waitMs);
        }

        const sliceLabel = slice.field ? ` [切片 ${sIdx + 1}/${slices.length}: ${slice.begin}~${slice.end}]` : "";
        console.log(`🔍 正在提交专利检索 (${endpoint})${sliceLabel}...`);
        const payload = opts.mode === "search" ? buildIndexPayload(sliceOpts, "") : buildAdvancedPayload(sliceOpts, "");
        const queryRes = await runPageJob(buildBrowserQueryScript(endpoint, payload, sliceOpts), jobTimeoutMs);

        if (!queryRes.ok || !queryRes.evalResult?.ok) {
          const errMsg = queryRes.evalResult?.error || JSON.stringify(queryRes.error);
          if (collectedRaw.length > 0) {
            circuitBroken = true;
            circuitBreakReason = errMsg;
            console.warn(`⚠️ ${errMsg}，已触发风控熔断并保底落盘前序切片已抓取的 ${collectedRaw.length} 条记录`);
            break;
          }
          throw new Error(`专利检索失败: ${errMsg}`);
        }

        const data = queryRes.evalResult;
        currentToken = data.token || currentToken;
        if (totalCount === null && data.totalCount !== null && data.totalCount !== undefined) {
          totalCount = data.totalCount;
        }
        totalPages = Math.max(totalPages, data.totalPages || 0);
        const batchItems = data.items || [];
        collectedRaw.push(...batchItems);
        console.log(`📊${sliceLabel} 本批提取 ${batchItems.length} 条（累计 ${collectedRaw.length} 条${data.totalCount != null ? ` / 命中 ${data.totalCount} 条` : ""}）`);

        if (data.circuitBroken) {
          circuitBroken = true;
          circuitBreakReason = data.breakReason || "分页触发风控熔断";
          console.warn(`⚠️ ${circuitBreakReason}，停止后续请求并保底保存已抓取结果`);
          break;
        }
      }

      const { added: uniqueRaw } = deduplicateAndMerge(collectedRaw, []);
      for (let i = 0; i < uniqueRaw.length; i++) {
        const item = uniqueRaw[i];
        let detail = null;
        const handle = item.detail_handle || item.sw_handle;
        if (opts.deep && handle && !circuitBroken) {
          if (i > 0 && opts.delayMs > 0) await sleep(computeJitterMs(opts.delayMs));
          console.log(`  [${i + 1}/${uniqueRaw.length}] 正在获取详情与事务状态: ${item.pn || item.an}`);
          const dRes = await runPageJob(buildBrowserSwDetailScript(handle, currentToken));
          if (dRes.ok && dRes.evalResult?.ok) {
            detail = dRes.evalResult;
          } else if (dRes.evalResult?.blocked) {
            circuitBroken = true;
            circuitBreakReason = dRes.evalResult.error || "详情接口触发风控熔断";
            console.warn(`⚠️ ${circuitBreakReason}，跳过剩余详情请求并保底落盘`);
          }
        }
        patents.push({
          index: i + 1,
          ...item,
          transactions: detail?.transactions || [],
          versions: detail?.versions || [],
          seqLinks: detail?.seqLinks || []
        });
      }
    }

    // 缩略图按需抓取 (--with-thumb)，避免无谓触发 epub.cnipa.gov.cn/imgs/ 风控
    if (opts.withThumb && !opts.skipMedia && !circuitBroken && patents.length > 0) {
      for (let i = 0; i < patents.length; i++) {
        const item = patents[i];
        if (item.thumb_url && item.thumb_url.startsWith("http")) {
          if (i > 0 && opts.delayMs > 0) await sleep(computeJitterMs(opts.delayMs));
          const imgRes = await runPageJob(buildBrowserFetchImageScript(item.thumb_url));
          if (imgRes.ok && imgRes.evalResult?.ok && imgRes.evalResult.base64) {
            const thumbName = `${String(item.index).padStart(2, "0")}_${sanitizeFilename(item.pn || item.an)}_thumb.jpg`;
            const thumbPath = path.join(mediaDir, thumbName);
            const buf = Buffer.from(imgRes.evalResult.base64, "base64");
            await fs.writeFile(thumbPath, buf);
            item.thumb_file = {
              file_name: thumbName,
              file_path: thumbPath,
              relative_path: path.relative(sessionDir, thumbPath).replace(/\\/g, "/"),
              size_bytes: buf.length
            };
          } else if (imgRes.evalResult?.blocked) {
            circuitBroken = true;
            circuitBreakReason = `HTTP ${imgRes.evalResult.status || 400} on thumb download`;
            console.warn(`⚠️ 缩略图拉取触发风控熔断 (${circuitBreakReason})，停止后续缩略图下载`);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error(`❌ 抓取失败: ${err.message}`);
    runLantern("end-task");
    process.exit(1);
  }

  runLantern("end-task");

  // 增量去重计算
  const dedupRes = deduplicateAndMerge(patents, existingPatents);
  const sessionPatents = dedupRes.added.map((item, idx) => ({ ...item, index: idx + 1 }));
  if (dedupJsonPath) {
    console.log(`🧩 增量去重结果：新增 ${dedupRes.added.length} 条，跳过重复 ${dedupRes.skippedDuplicates} 条，合并后累计 ${dedupRes.merged.length} 条`);
  }

  // 下载说明书高清页面 (egaz.cnipa.gov.cn 可直连，无需验证码)
  let totalMediaFiles = sessionPatents.filter((p) => p.thumb_file).length;
  if (!opts.skipMedia && opts.downloadPages && sessionPatents.length > 0) {
    for (const item of sessionPatents) {
      if (Array.isArray(item.versions) && item.versions.length > 0) {
        const targetVersion = item.versions.find((v) => v.ifs) || item.versions[0];
        if (targetVersion?.ifs) {
          const pagesDir = path.join(mediaDir, "pages", sanitizeFilename(item.pn || item.an));
          console.log(`  ⬇️ 正在下载说明书页面图片: ${item.pn || item.an}...`);
          const pageRes = await fetchSpecificationPages(targetVersion.ifs, pagesDir, opts.maxPages, opts.delayMs);
          item.spec_pages_total = pageRes.totalPages;
          item.downloaded_pages = pageRes.downloaded.map((d) => ({
            ...d,
            relative_path: path.relative(sessionDir, d.file_path).replace(/\\/g, "/")
          }));
          totalMediaFiles += pageRes.downloaded.length;
          console.log(`    ✅ 已下载 ${pageRes.downloaded.length}/${pageRes.totalPages} 页`);
        }
      }
    }
  }

  const outputJson = {
    platform: "CNIPA",
    site: BASE_URL,
    mode: opts.mode,
    target: opts.pn || opts.an || opts.query || opts.title || opts.applicant || opts.ipc || opts.swInfo || opts.mode,
    total_count: totalCount,
    total_pages: totalPages,
    total_patents: sessionPatents.length,
    total_media_files: totalMediaFiles,
    circuit_broken: circuitBroken,
    circuit_break_reason: circuitBreakReason || null,
    dedup_new_added: dedupRes.added.length,
    dedup_skipped: dedupRes.skippedDuplicates,
    fetched_at: new Date().toISOString(),
    session_dir: sessionDir,
    patents: sessionPatents
  };

  const jsonPath = path.join(sessionDir, "专利事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(outputJson, null, 2), "utf8");
  console.log(`\n💾 专利事实 JSON 已保存: ${jsonPath}`);

  const mdPath = path.join(sessionDir, "专利事实.md");
  await fs.writeFile(mdPath, generateMarkdown(outputJson), "utf8");
  console.log(`📄 专利事实 Markdown 已保存: ${mdPath}`);

  if (dedupJsonPath) {
    await fs.mkdir(path.dirname(dedupJsonPath), { recursive: true });
    const mergedJson = {
      ...outputJson,
      total_patents: dedupRes.merged.length,
      session_dir: path.dirname(dedupJsonPath),
      patents: dedupRes.merged
    };
    await fs.writeFile(dedupJsonPath, JSON.stringify(mergedJson, null, 2), "utf8");
    const mergedMdPath = path.join(path.dirname(dedupJsonPath), `${path.basename(dedupJsonPath, ".json")}.md`);
    await fs.writeFile(mergedMdPath, generateMarkdown(mergedJson), "utf8");
    console.log(`📚 累计合并档案已更新: ${dedupJsonPath} (共 ${dedupRes.merged.length} 条)`);
  }

  if (circuitBroken) {
    console.warn(`\n⚠️ 本次检索中途触发风控熔断 (${circuitBreakReason})，已保底落盘 ${sessionPatents.length} 条记录。建议稍后重试或改用更小的时间切片。`);
  } else {
    console.log(`\n🎉 CNIPA 专利事实抓取完成！共保存 ${sessionPatents.length} 条记录，${totalMediaFiles} 个媒体文件。`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error("❌ 执行出错:", err);
    process.exit(1);
  });
}
