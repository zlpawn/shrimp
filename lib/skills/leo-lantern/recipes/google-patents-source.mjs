#!/usr/bin/env node

/**
 * Google Patents (patents.google.com) 全球专利检索与文献事实探针 (Ground Truth Extractor)
 *
 * 核心设计原则：
 * 1. 真实浏览器同源请求：复用 Leo Lantern 真实 Chrome 会话打开 patents.google.com，在页面上下文内
 *    直接调用站点自身的 /xhr/query JSON 检索接口与 /patent/<号>/<语言> 详情页 SSR HTML，不依赖页面 DOM 渲染。
 * 2. 100% 事实保真：完整提取公开号、标题、摘要、全部权利要求、完整说明书、申请人（当前/原始）、发明人、
 *    优先权日/申请日/公开日/授权日、申请号、法律状态、事件时间线、CPC 分类、引用/被引、同族国家状态。
 * 3. 资产本地化：专利附图原图（patentimages.storage.googleapis.com）与 PDF 全文下载至 media/。
 * 4. 动态配置输出路径：CLI --out > ~/.shrimp/skills/leo-lantern/google-patents-source-config.json > 默认 (~/素材/google-patents)。
 */

import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../scripts/cli/index.mjs");
const BASE_URL = "https://patents.google.com";
const IMAGE_BASE = "https://patentimages.storage.googleapis.com";

const VALID_MODES = new Set(["search", "detail"]);
const VALID_SORTS = new Set(["relevance", "new", "old"]);
const VALID_DATE_TYPES = new Set(["priority", "filing", "publication"]);
const STATUS_MAP = { grant: "GRANT", granted: "GRANT", application: "APPLICATION", app: "APPLICATION" };
const TYPE_MAP = { patent: "PATENT", design: "DESIGN" };
const PAGE_SIZES = [10, 20, 50, 100];

// ==================== 配置与路径解析 ====================

export function getConfigPath() {
  return path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "google-patents-source-config.json");
}

export function loadConfig() {
  try {
    const cfgPath = getConfigPath();
    if (syncFs.existsSync(cfgPath)) {
      return JSON.parse(syncFs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, ""));
    }
  } catch {
    // 忽略损坏配置
  }
  return {};
}

export function saveConfig(patch) {
  const cfgPath = getConfigPath();
  try {
    syncFs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const updated = { ...loadConfig(), ...patch, updated_at: new Date().toISOString() };
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
  if (cfg.output_dir) return path.resolve(cfg.output_dir);
  return path.join(os.homedir(), "素材", "google-patents");
}

// ==================== 纯函数工具（可单测） ====================

/** 将 HTML 片段（检索接口里的 <b> 高亮、&hellip; 实体）还原为纯文本。 */
export function stripHtml(input) {
  return String(input || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** 统一公开号：去空格/连字符并大写，如 "us 12,482,160 b2" -> "US12482160B2"。 */
export function normalizePn(input) {
  return String(input || "").replace(/[\s,\-]/g, "").toUpperCase();
}

/** 从详情链接中解析公开号与语言，如 https://patents.google.com/patent/US12482160B2/en。 */
export function parsePatentUrl(url) {
  const m = String(url || "").match(/\/patent\/([A-Za-z0-9]+)(?:\/([a-z]{2}))?/);
  if (!m) return null;
  return { pn: normalizePn(m[1]), lang: m[2] || "en" };
}

/** 将 YYYY-MM-DD / YYYY.MM.DD / YYYYMMDD 统一为 YYYYMMDD（Google Patents before/after 参数格式）。 */
export function normalizeGpDate(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[./\-]/g, "");
  if (!/^\d{8}$/.test(digits)) throw new Error(`日期格式无效 "${input}"，请使用 YYYY-MM-DD`);
  return digits;
}

export function computeJitterMs(baseMs, rand = Math.random) {
  if (!baseMs || baseMs <= 0) return 0;
  return Math.round(baseMs * (1 + rand() * 0.6));
}

/** Google Patents 只接受 10/20/50/100 的每页条数，取不小于 limit 的最小档位。 */
export function pickPageSize(limit) {
  return PAGE_SIZES.find((n) => n >= limit) || 100;
}

function encodeTerm(value) {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/**
 * 构造 /xhr/query 的内层 url 参数（与站点前端一致：q=(...)&assignee=...&country=...）。
 * 若传入 rawQuery（检索页地址栏里 ? 之后的部分），则直接透传，只覆盖 num/page。
 */
export function buildInnerQuery(opts, page = 0) {
  const num = pickPageSize(opts.limit);
  if (opts.rawQuery) {
    const kept = opts.rawQuery
      .replace(/^\?/, "")
      .split("&")
      .filter((kv) => kv && !/^(num|page)=/.test(kv));
    return [...kept, `num=${num}`, `page=${page}`].join("&");
  }
  const parts = [];
  for (const term of opts.queries) parts.push(`q=(${encodeTerm(term)})`);
  for (const cpc of opts.cpc) parts.push(`q=(${encodeTerm(`CPC=${cpc}`)})`);
  if (opts.assignee) parts.push(`assignee=${encodeTerm(opts.assignee)}`);
  if (opts.inventor) parts.push(`inventor=${encodeTerm(opts.inventor)}`);
  if (opts.country.length) parts.push(`country=${opts.country.join(",")}`);
  if (opts.before) parts.push(`before=${opts.dateType}:${opts.before}`);
  if (opts.after) parts.push(`after=${opts.dateType}:${opts.after}`);
  if (opts.status) parts.push(`status=${opts.status}`);
  if (opts.type) parts.push(`type=${opts.type}`);
  if (opts.language) parts.push(`language=${opts.language}`);
  if (opts.sort && opts.sort !== "relevance") parts.push(`sort=${opts.sort}`);
  parts.push(`num=${num}`, `page=${page}`);
  return parts.join("&");
}

export function buildQueryUrl(opts, page = 0) {
  return `/xhr/query?url=${encodeURIComponent(buildInnerQuery(opts, page))}&exp=`;
}

/** 把检索接口返回的单条 result 规范为扁平记录。 */
export function mapSearchResult(item) {
  const p = item?.patent || {};
  const pn = normalizePn(p.publication_number || String(item?.id || "").split("/")[1] || "");
  const lang = String(item?.id || "").split("/")[2] || p.language || "en";
  return {
    publication_number: pn,
    language: lang,
    url: `${BASE_URL}/patent/${pn}/${lang}`,
    title: stripHtml(p.title),
    snippet: stripHtml(p.snippet),
    assignee: stripHtml(p.assignee),
    inventor: stripHtml(p.inventor),
    priority_date: p.priority_date || "",
    filing_date: p.filing_date || "",
    publication_date: p.publication_date || "",
    grant_date: p.grant_date || "",
    pdf_url: p.pdf ? `${IMAGE_BASE}/${p.pdf}` : "",
    thumbnail_url: p.thumbnail ? `${IMAGE_BASE}/${p.thumbnail}` : "",
    figures: (p.figures || []).map((f) => `${IMAGE_BASE}/${f.full}`),
    family_country_status: (p.family_metadata?.aggregated?.country_status || []).map((c) => ({
      country: c.country_code,
      state: c.best_patent_stage?.state || ""
    }))
  };
}

export function deduplicateAndMerge(newItems, existing = []) {
  const seen = new Set(existing.map((p) => normalizePn(p.publication_number)));
  const added = [];
  let skippedDuplicates = 0;
  for (const item of newItems) {
    const key = normalizePn(item.publication_number);
    if (!key || seen.has(key)) {
      skippedDuplicates++;
      continue;
    }
    seen.add(key);
    added.push(item);
  }
  const merged = [...existing, ...added].map((p, i) => ({ ...p, index: i + 1 }));
  return { added, merged, skippedDuplicates };
}

function slugify(text) {
  return String(text || "")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "query";
}

function splitList(value) {
  return String(value || "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ==================== 参数解析 ====================

export function parseCliArgs(argv) {
  const opts = {
    mode: "",
    queries: [],
    cpc: [],
    assignee: "",
    inventor: "",
    country: [],
    dateType: "priority",
    before: "",
    after: "",
    status: "",
    type: "",
    language: "",
    sort: "relevance",
    rawQuery: "",
    pns: [],
    lang: "en",
    limit: 10,
    deep: undefined,
    downloadFigures: undefined,
    downloadPdf: undefined,
    maxFigures: 0,
    skipMedia: false,
    delayMs: 1500,
    dedupFile: "",
    out: "",
    setOut: "",
    getOut: false,
    help: false
  };

  const takeValue = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} 需要一个值`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inlineVal;
    if (arg.startsWith("--") && arg.includes("=")) {
      [arg, inlineVal] = [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)];
    }
    const val = (flag) => {
      if (inlineVal !== undefined) return inlineVal;
      const v = takeValue(i, flag);
      i++;
      return v;
    };

    switch (arg) {
      case "--mode": case "-m": opts.mode = val(arg).toLowerCase(); break;
      case "--query": case "-q": opts.queries.push(val(arg)); break;
      case "--cpc": opts.cpc.push(...splitList(val(arg))); break;
      case "--assignee": opts.assignee = val(arg); break;
      case "--inventor": opts.inventor = val(arg); break;
      case "--country": opts.country = splitList(val(arg)).map((c) => c.toUpperCase()); break;
      case "--date-type": opts.dateType = val(arg).toLowerCase(); break;
      case "--before": opts.before = normalizeGpDate(val(arg)); break;
      case "--after": opts.after = normalizeGpDate(val(arg)); break;
      case "--status": {
        const s = val(arg).toLowerCase();
        if (!STATUS_MAP[s]) throw new Error(`--status 无效 "${s}"，可选: grant, application`);
        opts.status = STATUS_MAP[s];
        break;
      }
      case "--type": {
        const t = val(arg).toLowerCase();
        if (!TYPE_MAP[t]) throw new Error(`--type 无效 "${t}"，可选: patent, design`);
        opts.type = TYPE_MAP[t];
        break;
      }
      case "--language": opts.language = val(arg).toUpperCase(); break;
      case "--sort": opts.sort = val(arg).toLowerCase(); break;
      case "--pn": opts.pns.push(...splitList(val(arg)).map(normalizePn)); break;
      case "--lang": opts.lang = val(arg).toLowerCase(); break;
      case "--url": case "-u": {
        const u = val(arg);
        const parsed = parsePatentUrl(u);
        if (parsed) {
          opts.pns.push(parsed.pn);
          opts.lang = parsed.lang;
        } else if (/patents\.google\.com\/?\?/.test(u)) {
          opts.rawQuery = u.slice(u.indexOf("?") + 1);
        } else {
          throw new Error(`无法识别的 Google Patents 链接: ${u}`);
        }
        break;
      }
      case "--limit": case "-n": opts.limit = Math.max(1, parseInt(val(arg), 10) || 10); break;
      case "--deep": opts.deep = true; break;
      case "--no-deep": opts.deep = false; break;
      case "--download-figures": opts.downloadFigures = true; break;
      case "--no-download-figures": opts.downloadFigures = false; break;
      case "--download-pdf": opts.downloadPdf = true; break;
      case "--no-download-pdf": opts.downloadPdf = false; break;
      case "--max-figures": opts.maxFigures = Math.max(0, parseInt(val(arg), 10) || 0); break;
      case "--skip-media": case "--no-media": opts.skipMedia = true; break;
      case "--delay-ms": opts.delayMs = Math.max(0, parseInt(val(arg), 10) || 0); break;
      case "--dedup-file": case "--merge": opts.dedupFile = val(arg); break;
      case "--out": case "--out-dir": case "-o": opts.out = val(arg); break;
      case "--set-out": opts.setOut = val(arg); break;
      case "--get-out": opts.getOut = true; break;
      case "--help": case "-h": opts.help = true; break;
      default: {
        if (arg.startsWith("-")) throw new Error(`未知参数: ${arg}`);
        const parsed = parsePatentUrl(arg);
        if (parsed) {
          opts.pns.push(parsed.pn);
          opts.lang = parsed.lang;
        } else if (/patents\.google\.com\/?\?/.test(arg)) {
          opts.rawQuery = arg.slice(arg.indexOf("?") + 1);
        } else if (/^[A-Za-z]{2}\d/.test(arg)) {
          opts.pns.push(normalizePn(arg));
        } else {
          opts.queries.push(arg);
        }
      }
    }
  }

  if (opts.help || opts.setOut || opts.getOut) return opts;

  if (!opts.mode) opts.mode = opts.pns.length ? "detail" : "search";
  if (!VALID_MODES.has(opts.mode)) throw new Error(`--mode 无效 "${opts.mode}"，可选: search, detail`);
  if (!VALID_SORTS.has(opts.sort)) throw new Error(`--sort 无效 "${opts.sort}"，可选: relevance, new, old`);
  if (!VALID_DATE_TYPES.has(opts.dateType)) throw new Error(`--date-type 无效 "${opts.dateType}"，可选: priority, filing, publication`);

  const hasSearchCondition = opts.rawQuery || opts.queries.length || opts.cpc.length || opts.assignee || opts.inventor;
  if (opts.mode === "search" && !hasSearchCondition) {
    throw new Error("search 模式需要至少一个检索条件：--query / --assignee / --inventor / --cpc / --url <检索页链接>");
  }
  if (opts.mode === "detail" && !opts.pns.length) {
    throw new Error("detail 模式需要 --pn <公开号> 或 --url <专利详情链接>");
  }

  const isDetail = opts.mode === "detail";
  if (opts.deep === undefined) opts.deep = true;
  if (opts.downloadFigures === undefined) opts.downloadFigures = isDetail;
  if (opts.downloadPdf === undefined) opts.downloadPdf = isDetail;
  if (opts.skipMedia) {
    opts.downloadFigures = false;
    opts.downloadPdf = false;
  }
  return opts;
}

// ==================== Leo Lantern CLI 封装 ====================

function runLantern(cmd, args = []) {
  const res = spawnSync("node", [CLI_PATH, cmd, ...args], { encoding: "utf8", maxBuffer: 200 * 1024 * 1024 });
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
  const tmpFile = path.join(os.tmpdir(), `gp_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
  try {
    syncFs.writeFileSync(tmpFile, code, "utf8");
    return runLantern("eval", ["--file", tmpFile]);
  } finally {
    try { syncFs.unlinkSync(tmpFile); } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 在页面后台执行异步脚本并轮询结果，规避单次 eval 超时（长说明书 / 慢网络时尤其重要）。
 * body 为异步函数体，必须 return 可序列化结果。
 */
async function runAsyncInPage(body, { timeoutMs = 90_000 } = {}) {
  const starter = `(() => {
    window.__leoGp = window.__leoGp || {};
    const id = 'j' + Date.now() + Math.random().toString(36).slice(2);
    window.__leoGp[id] = { done: false };
    (async () => { ${body} })()
      .then((result) => { window.__leoGp[id] = { done: true, ok: true, result }; })
      .catch((e) => { window.__leoGp[id] = { done: true, ok: false, error: String((e && e.message) || e) }; });
    return id;
  })()`;
  const start = runLanternEval(starter);
  if (!start.ok || !start.evalResult) return { ok: false, error: start.error || "无法在页面启动后台任务" };
  const jobId = start.evalResult;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(400);
    const poll = runLanternEval(`(() => {
      const j = window.__leoGp && window.__leoGp[${JSON.stringify(jobId)}];
      if (j && j.done) delete window.__leoGp[${JSON.stringify(jobId)}];
      return j || { done: false, lost: true };
    })()`);
    if (!poll.ok) return { ok: false, error: poll.error };
    const job = poll.evalResult;
    if (job?.lost) return { ok: false, error: "页面已跳转或刷新，后台任务丢失" };
    if (job?.done) return job.ok ? { ok: true, result: job.result } : { ok: false, error: job.error };
  }
  return { ok: false, error: `页面后台任务超时 (${timeoutMs}ms)` };
}

async function ensureOnGooglePatents() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = runLanternEval(`(() => ({ host: location.hostname, ready: document.readyState }))()`);
    if (res.ok && res.evalResult?.host === "patents.google.com" && res.evalResult.ready !== "loading") return true;
    await sleep(500);
  }
  return false;
}

// ==================== 页面内执行脚本 ====================

function searchPageScript(queryUrl) {
  return `
    const res = await fetch(${JSON.stringify(queryUrl)}, { credentials: 'include' });
    if (!res.ok) return { ok: false, status: res.status };
    const j = await res.json();
    const r = j && j.results ? j.results : {};
    const items = [];
    for (const c of r.cluster || []) for (const it of c.result || []) items.push(it);
    return { ok: true, status: res.status, total: r.total_num_results || 0, totalPages: r.total_num_pages || 0, items };
  `;
}

function detailPageScript(pn, lang) {
  return `
    const res = await fetch(${JSON.stringify(`/patent/${pn}/${lang}`)}, { credentials: 'include' });
    if (!res.ok) return { ok: false, status: res.status };
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const T = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : '');
    const all = (sel, root = doc) => Array.from(root.querySelectorAll(sel));
    const first = (sel, root = doc) => root.querySelector(sel);

    const claimsSec = first('section[itemprop="claims"]');
    const claims = claimsSec
      ? all('div.claim', claimsSec).filter((el) => !el.parentElement.closest('div.claim')).map(T).filter(Boolean)
      : [];
    const descSec = first('section[itemprop="description"]');
    const description = descSec
      ? all('.description-paragraph, .description-line, heading, p', descSec).map(T).filter(Boolean).join('\\n\\n') || T(descSec)
      : '';

    const classifications = all('li[itemprop="classifications"]')
      .filter((li) => first('meta[itemprop="Leaf"]', li))
      .map((li) => ({ code: T(first('[itemprop="Code"]', li)), description: T(first('[itemprop="Description"]', li)) }))
      .filter((c) => c.code);

    const refRow = (tr) => ({
      publication_number: T(first('[itemprop="publicationNumber"]', tr)),
      priority_date: T(first('[itemprop="priorityDate"]', tr)),
      publication_date: T(first('[itemprop="publicationDate"]', tr)),
      assignee: T(first('[itemprop="assigneeOriginal"]', tr)),
      title: T(first('[itemprop="title"]', tr)),
      examiner_cited: Boolean(first('[itemprop="examinerCited"]', tr))
    });

    const pdfAnchor = all('a[href]').map((a) => a.getAttribute('href')).find((h) => /\\.pdf($|\\?)/i.test(h)) || '';

    return {
      ok: true,
      status: res.status,
      detail: {
        title: T(first('meta[name="DC.title"]') ? { textContent: first('meta[name="DC.title"]').getAttribute('content') } : first('#title, span[itemprop="title"]')),
        publication_number: T(first('dd[itemprop="publicationNumber"]')),
        kind_code: first('meta[itemprop="kindCode"]')?.getAttribute('content') || '',
        country: T(first('dd[itemprop="countryName"]')),
        application_number: T(first('dd[itemprop="applicationNumber"]')),
        legal_status: T(first('dd[itemprop="legalStatusIfi"] [itemprop="status"]')) || T(first('dd[itemprop="legalStatusIfi"]')),
        priority_date: T(first('time[itemprop="priorityDate"]')),
        filing_date: T(first('time[itemprop="filingDate"]')),
        publication_date: T(first('time[itemprop="publicationDate"]')),
        inventors: all('dd[itemprop="inventor"]').map(T),
        assignee_current: all('dd[itemprop="assigneeCurrent"]').map(T),
        assignee_original: all('dd[itemprop="assigneeOriginal"]').map(T),
        abstract: T(first('section[itemprop="abstract"] div[itemprop="content"]')) || T(first('section[itemprop="abstract"]')).replace(/^Abstract\\s*/, ''),
        claims_count: parseInt(T(first('section[itemprop="claims"] [itemprop="count"]')), 10) || claims.length,
        claims,
        description,
        classifications,
        events: all('dd[itemprop="events"]').map((dd) => ({
          date: first('time[itemprop="date"]', dd)?.getAttribute('datetime') || '',
          title: T(first('[itemprop="title"]', dd)),
          type: T(first('[itemprop="type"]', dd)),
          critical: Boolean(first('[itemprop="critical"]', dd))
        })),
        figures: all('li[itemprop="images"] meta[itemprop="full"]').map((m) => m.getAttribute('content')).filter(Boolean),
        pdf_url: pdfAnchor,
        citations: all('tr[itemprop="backwardReferencesOrig"], tr[itemprop="backwardReferences"]').map(refRow),
        cited_by: all('tr[itemprop="forwardReferencesOrig"], tr[itemprop="forwardReferences"], tr[itemprop="forwardReferencesFamily"]').map(refRow),
        similar_documents_count: all('tr[itemprop="similarDocuments"]').length,
        family_country_status: all('tr[itemprop="countryStatus"]').map((tr) => ({
          country: T(first('[itemprop="countryCode"]', tr)),
          count: T(first('[itemprop="num"]', tr))
        }))
      }
    };
  `;
}

// ==================== 媒体下载 ====================

async function downloadFile(url, destPath) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Referer: `${BASE_URL}/`
      }
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(destPath, buf);
    return { ok: true, size: buf.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function uniqueByPn(list) {
  const seen = new Set();
  return list.filter((p) => {
    const k = normalizePn(p.publication_number);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dedupRefs(list) {
  const seen = new Set();
  return list.filter((r) => {
    if (!r.publication_number || seen.has(r.publication_number)) return false;
    seen.add(r.publication_number);
    return true;
  });
}

// ==================== Markdown 生成 ====================

export function generateMarkdown(payload) {
  const lines = [];
  lines.push(`# Google Patents 专利事实档案：${payload.target}`);
  lines.push("");
  lines.push(`> **模式**：${payload.mode}  `);
  if (payload.query_url) lines.push(`> **检索条件**：\`${payload.query_url}\`  `);
  if (payload.total_results !== undefined) lines.push(`> **站内命中总数**：${payload.total_results}  `);
  lines.push(`> **本次保存**：${payload.patents.length} 件专利，${payload.total_media_files || 0} 个媒体文件  `);
  lines.push(`> **抓取时间**：${payload.fetched_at}`);
  lines.push("");

  if (payload.patents.length > 1) {
    lines.push("## 概览");
    lines.push("");
    lines.push("| # | 公开号 | 标题 | 申请人 | 优先权日 | 公开日 | 状态 |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |");
    for (const p of payload.patents) {
      const assignee = (p.assignee_current?.[0] || p.assignee || "").replace(/\|/g, "/");
      lines.push(`| ${p.index} | [${p.publication_number}](${p.url}) | ${String(p.title || "").replace(/\|/g, "/")} | ${assignee} | ${p.priority_date || ""} | ${p.publication_date || ""} | ${p.legal_status || ""} |`);
    }
    lines.push("");
  }

  for (const p of payload.patents) {
    lines.push(`## ${p.index}. ${p.title || p.publication_number}`);
    lines.push("");
    lines.push(`- **公开号**：[${p.publication_number}](${p.url})${p.kind_code ? `（${p.kind_code}）` : ""}`);
    if (p.application_number) lines.push(`- **申请号**：${p.application_number}`);
    const assignees = p.assignee_current?.length ? p.assignee_current.join("；") : p.assignee;
    if (assignees) lines.push(`- **申请人/专利权人**：${assignees}`);
    const inventors = p.inventors?.length ? p.inventors.join("；") : p.inventor;
    if (inventors) lines.push(`- **发明人**：${inventors}`);
    const dates = [
      p.priority_date && `优先权日 ${p.priority_date}`,
      p.filing_date && `申请日 ${p.filing_date}`,
      p.publication_date && `公开日 ${p.publication_date}`,
      p.grant_date && `授权日 ${p.grant_date}`
    ].filter(Boolean);
    if (dates.length) lines.push(`- **关键日期**：${dates.join(" · ")}`);
    if (p.legal_status) lines.push(`- **法律状态**：${p.legal_status}`);
    if (p.classifications?.length) lines.push(`- **CPC 分类**：${p.classifications.slice(0, 12).map((c) => `\`${c.code}\``).join(" ")}`);
    if (p.family_country_status?.length) {
      lines.push(`- **同族国家**：${p.family_country_status.map((c) => c.state ? `${c.country}(${c.state})` : `${c.country}${c.count ? `×${c.count}` : ""}`).join(" ")}`);
    }
    if (p.citations || p.cited_by) lines.push(`- **引用 / 被引**：${p.citations?.length || 0} / ${p.cited_by?.length || 0}`);
    if (p.claims_count) lines.push(`- **权利要求数**：${p.claims_count}`);
    lines.push("");

    if (p.abstract || p.snippet) {
      lines.push(p.abstract ? "### 摘要" : "### 命中片段");
      lines.push("");
      lines.push(p.abstract || p.snippet);
      lines.push("");
    }
    if (p.claims?.length) {
      lines.push("### 独立权利要求 1");
      lines.push("");
      lines.push(p.claims[0]);
      lines.push("");
    }
    if (p.local_files) {
      const f = p.local_files;
      const refs = [
        f.claims && `[权利要求全文](${f.claims})`,
        f.description && `[说明书全文](${f.description})`,
        f.pdf && `[PDF](${f.pdf})`
      ].filter(Boolean);
      if (refs.length) {
        lines.push(`**本地文件**：${refs.join(" · ")}`);
        lines.push("");
      }
      if (f.figures?.length) {
        lines.push("### 附图");
        lines.push("");
        for (const fig of f.figures.slice(0, 6)) lines.push(`![${path.basename(fig)}](${fig})`);
        if (f.figures.length > 6) lines.push(`\n> 其余 ${f.figures.length - 6} 张附图见 \`${path.dirname(f.figures[0])}/\``);
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

// ==================== 帮助信息 ====================

function printHelp() {
  console.log(`
Google Patents 全球专利检索与文献事实探针

用法:
  node google-patents-source.mjs --query "neural network" [选项]
  node google-patents-source.mjs --pn US12482160B2
  node google-patents-source.mjs https://patents.google.com/patent/US12482160B2/en

检索条件 (search):
  --query, -q <词>        关键词（可多次传入，均为 AND）
  --assignee <名称>       申请人 / 专利权人
  --inventor <姓名>       发明人
  --cpc <分类号,...>      CPC 分类号，如 G06N3/08
  --country <US,CN,...>   国家/地区代码
  --date-type <类型>      priority | filing | publication（默认 priority）
  --after / --before <日期> 起止日期 YYYY-MM-DD
  --status <状态>         grant | application
  --type <类型>           patent | design
  --language <语言>       ENGLISH | CHINESE | JAPANESE ...
  --sort <排序>           relevance | new | old（默认 relevance）
  --url <检索页链接>      直接透传 patents.google.com/?q=... 的检索条件

详情 (detail):
  --pn <公开号,...>       一个或多个公开号
  --url <详情链接>        https://patents.google.com/patent/<公开号>/<语言>
  --lang <语言>           详情页语言（默认 en）

通用:
  --limit, -n <数量>      最多保存条数（默认 10）
  --deep / --no-deep      是否逐条抓取详情（摘要/全部权利要求/说明书/CPC/引用，默认开启）
  --download-figures      下载附图原图（detail 默认开启）
  --download-pdf          下载 PDF 全文（detail 默认开启，仅部分文献提供）
  --max-figures <数量>    每件专利最多下载的附图数（默认不限）
  --skip-media            跳过所有媒体下载
  --delay-ms <毫秒>       详情/翻页间基础延迟（默认 1500，附加 1.0~1.6x 抖动）
  --dedup-file <JSON>     按公开号增量去重并合并回写累计档案
  --out, -o <目录>        输出目录（自动持久化）
  --set-out / --get-out   设置或查看持久化输出目录
`);
}

// ==================== 主流程 ====================

async function main() {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ 参数错误: ${err.message}`);
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.setOut) {
    const saved = saveConfig({ output_dir: path.resolve(opts.setOut) });
    console.log(`✅ 已持久化 Google Patents 默认输出目录: ${saved?.output_dir}`);
    return;
  }
  if (opts.getOut) {
    console.log(`📂 当前 Google Patents 默认输出目录: ${loadConfig().output_dir || resolveOutputDir("")}`);
    return;
  }

  const outRoot = resolveOutputDir(opts.out);
  const target = opts.mode === "detail"
    ? opts.pns.join(",")
    : (opts.rawQuery ? decodeURIComponent(opts.rawQuery).slice(0, 60) : [...opts.queries, ...opts.cpc, opts.assignee, opts.inventor].filter(Boolean).join(" "));
  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 8).replace(/:/g, "")}`;
  const sessionDir = path.join(outRoot, `${stamp}_${opts.mode}_${slugify(target)}`);
  const mediaDir = path.join(sessionDir, "media");
  const patentsDir = path.join(sessionDir, "patents");
  await fs.mkdir(sessionDir, { recursive: true });

  console.log("🚀 Leo Lantern Google Patents 专利事实探针启动");
  console.log(`📌 模式: ${opts.mode} | 目标: ${target} | 上限: ${opts.limit} | 详情: ${opts.deep ? "是" : "否"} | 附图: ${opts.downloadFigures ? "是" : "否"} | PDF: ${opts.downloadPdf ? "是" : "否"}`);
  console.log(`📂 本次落盘目录: ${sessionDir}`);

  // 1. 桥接与任务窗口
  const startRes = runLantern("start");
  if (!startRes.ok || !startRes.extensionOnline) {
    console.error("❌ Leo Lantern 未就绪（请确认 Chrome 已打开并启用 Leo cookie.txt Locally 扩展）:", JSON.stringify(startRes.error || startRes));
    process.exit(1);
  }
  const taskRes = runLantern("start-task", ["--title", "google-patents-source"]);
  if (!taskRes.ok) {
    console.error("❌ 无法创建浏览器任务:", JSON.stringify(taskRes.error));
    process.exit(1);
  }
  const gotoRes = runLantern("goto", [`${BASE_URL}/`]);
  if (!gotoRes.ok || !(await ensureOnGooglePatents())) {
    console.error("❌ 无法打开 patents.google.com:", JSON.stringify(gotoRes.error || "页面未就绪"));
    runLantern("end-task", ["--close-group"]);
    process.exit(1);
  }

  let patents = [];
  let totalResults;
  let queryUrl = "";
  let interrupted = "";

  try {
    // 2. 检索或直取公开号
    if (opts.mode === "search") {
      let page = 0;
      let totalPages = 1;
      while (patents.length < opts.limit && page < totalPages) {
        queryUrl = buildQueryUrl(opts, page);
        if (page === 0) console.log(`\n🔎 检索接口: ${BASE_URL}${queryUrl}`);
        const res = await runAsyncInPage(searchPageScript(queryUrl));
        if (!res.ok || !res.result?.ok) {
          interrupted = `检索第 ${page + 1} 页失败: ${res.error || `HTTP ${res.result?.status}`}`;
          break;
        }
        totalResults = res.result.total;
        totalPages = res.result.totalPages || 1;
        const mapped = res.result.items.map(mapSearchResult);
        if (!mapped.length) break;
        patents = uniqueByPn([...patents, ...mapped]);
        console.log(`📄 第 ${page + 1}/${totalPages} 页：累计 ${patents.length} 件（站内命中 ${totalResults}）`);
        page++;
        if (patents.length < opts.limit && page < totalPages) await sleep(computeJitterMs(opts.delayMs));
      }
      patents = patents.slice(0, opts.limit);
      queryUrl = buildInnerQuery(opts, 0);
    } else {
      patents = opts.pns.slice(0, opts.limit).map((pn) => ({
        publication_number: pn,
        language: opts.lang,
        url: `${BASE_URL}/patent/${pn}/${opts.lang}`
      }));
    }

    // 3. 逐条详情
    if (opts.deep) {
      for (let i = 0; i < patents.length; i++) {
        const p = patents[i];
        process.stdout.write(`\n📖 [${i + 1}/${patents.length}] 解析详情 ${p.publication_number} ... `);
        const res = await runAsyncInPage(detailPageScript(p.publication_number, p.language || opts.lang));
        if (!res.ok || !res.result?.ok) {
          const status = res.result?.status;
          console.log(`失败 (${res.error || `HTTP ${status}`})`);
          if (status === 429 || status === 403) {
            interrupted = `详情请求被限流 (HTTP ${status})，已停止后续详情抓取`;
            break;
          }
          continue;
        }
        const d = res.result.detail;
        patents[i] = {
          ...p,
          ...Object.fromEntries(Object.entries(d).filter(([, v]) => !(v === "" || (Array.isArray(v) && v.length === 0)))),
          publication_number: normalizePn(d.publication_number || p.publication_number),
          figures: d.figures?.length ? d.figures : p.figures || [],
          pdf_url: d.pdf_url || p.pdf_url || "",
          citations: dedupRefs(d.citations || []),
          cited_by: dedupRefs(d.cited_by || [])
        };
        console.log(`✅ 权利要求 ${patents[i].claims_count || 0} 项 · 说明书 ${(d.description || "").length} 字符 · 附图 ${patents[i].figures.length} 张`);
        if (i < patents.length - 1) await sleep(computeJitterMs(opts.delayMs));
      }
    }
  } finally {
    runLantern("end-task", ["--close-group"]);
  }

  // 4. 落盘长文本与媒体
  let totalMediaFiles = 0;
  for (let i = 0; i < patents.length; i++) {
    const p = patents[i];
    p.index = i + 1;
    const pn = p.publication_number;
    const local = {};

    if (p.claims?.length || p.description) {
      const dir = path.join(patentsDir, pn);
      await fs.mkdir(dir, { recursive: true });
      if (p.claims?.length) {
        const file = path.join(dir, "claims.md");
        await fs.writeFile(file, `# ${pn} 权利要求（共 ${p.claims_count || p.claims.length} 项）\n\n${p.claims.join("\n\n")}\n`, "utf8");
        local.claims = path.relative(sessionDir, file);
      }
      if (p.description) {
        const file = path.join(dir, "description.md");
        await fs.writeFile(file, `# ${pn} 说明书\n\n${p.description}\n`, "utf8");
        local.description = path.relative(sessionDir, file);
      }
    }

    if (opts.downloadFigures && p.figures?.length) {
      const figDir = path.join(mediaDir, pn);
      await fs.mkdir(figDir, { recursive: true });
      const figs = opts.maxFigures ? p.figures.slice(0, opts.maxFigures) : p.figures;
      local.figures = [];
      for (let k = 0; k < figs.length; k++) {
        const ext = path.extname(new URL(figs[k]).pathname) || ".png";
        const dest = path.join(figDir, `fig_${String(k + 1).padStart(2, "0")}${ext}`);
        const r = await downloadFile(figs[k], dest);
        if (r.ok) {
          local.figures.push(path.relative(sessionDir, dest));
          totalMediaFiles++;
        }
      }
      console.log(`🖼️ ${pn}: 附图 ${local.figures.length}/${figs.length} 张已落盘`);
    }

    if (opts.downloadPdf && p.pdf_url) {
      await fs.mkdir(path.join(mediaDir, pn), { recursive: true });
      const dest = path.join(mediaDir, pn, `${pn}.pdf`);
      const r = await downloadFile(p.pdf_url, dest);
      if (r.ok) {
        local.pdf = path.relative(sessionDir, dest);
        totalMediaFiles++;
        console.log(`📑 ${pn}: PDF 已落盘 (${(r.size / 1024).toFixed(0)} KB)`);
      } else {
        console.warn(`⚠️ ${pn}: PDF 下载失败 (${r.error})`);
      }
    } else if (opts.downloadPdf) {
      console.log(`ℹ️ ${pn}: Google Patents 未提供 PDF 全文`);
    }

    if (Object.keys(local).length) p.local_files = local;
  }

  // 5. 事实档案（JSON 中不重复存放超长说明书，改为引用本地文件）
  const jsonPatents = patents.map((p) => {
    const { description, ...rest } = p;
    return description ? { ...rest, description_length: description.length } : rest;
  });
  const payload = {
    source: "patents.google.com",
    mode: opts.mode,
    target,
    query_url: opts.mode === "search" ? `${BASE_URL}/?${queryUrl.replace(/&?(num|page)=\d+/g, "")}` : "",
    total_results: totalResults,
    total_count: patents.length,
    total_media_files: totalMediaFiles,
    interrupted: interrupted || undefined,
    fetched_at: new Date().toISOString(),
    session_dir: sessionDir,
    patents: jsonPatents
  };
  const jsonPath = path.join(sessionDir, "专利事实.json");
  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(path.join(sessionDir, "专利事实.md"), generateMarkdown(payload), "utf8");
  console.log(`\n📋 事实档案: ${jsonPath}`);

  if (opts.dedupFile) {
    const dedupPath = path.resolve(opts.dedupFile.endsWith(".json") ? opts.dedupFile : path.join(opts.dedupFile, "专利事实.json"));
    let existing = [];
    try {
      existing = JSON.parse(await fs.readFile(dedupPath, "utf8")).patents || [];
    } catch {
      // 首次创建
    }
    const merged = deduplicateAndMerge(jsonPatents, existing);
    const mergedPayload = { ...payload, total_count: merged.merged.length, session_dir: path.dirname(dedupPath), patents: merged.merged };
    await fs.mkdir(path.dirname(dedupPath), { recursive: true });
    await fs.writeFile(dedupPath, JSON.stringify(mergedPayload, null, 2), "utf8");
    await fs.writeFile(dedupPath.replace(/\.json$/, ".md"), generateMarkdown(mergedPayload), "utf8");
    console.log(`📚 累计档案已合并: ${dedupPath}（新增 ${merged.added.length}，跳过重复 ${merged.skippedDuplicates}，共 ${merged.merged.length}）`);
  }

  if (interrupted) {
    console.warn(`\n⚠️ ${interrupted}；已保底落盘 ${patents.length} 件。`);
    process.exitCode = patents.length ? 0 : 1;
  } else {
    console.log(`\n🎉 Google Patents 抓取完成！共保存 ${patents.length} 件专利，${totalMediaFiles} 个媒体文件。`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error("❌ 执行出错:", err);
    runLantern("end-task", ["--close-group"]);
    process.exit(1);
  });
}
