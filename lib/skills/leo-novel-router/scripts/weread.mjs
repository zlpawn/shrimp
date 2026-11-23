import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readConfig, resolveBookDestination } from "./config.mjs";
import { locateLanternCli } from "./probe.mjs";

const STYLE_LABELS = {
  0: "直线",
  1: "马克笔",
  2: "波浪线",
};

const COLOR_LABELS = {
  1: "红",
  2: "紫",
  3: "蓝",
  4: "绿",
  5: "橙",
};

/**
 * Normalize a WeRead reader URL or hash to canonical reader URL and hash.
 */
export function parseBookInput(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("请提供微信读书书籍链接或 bookHash（例如 https://weread.qq.com/web/reader/b63327207183c09db6382cf）");
  }
  const match = raw.match(/\/web\/reader\/([a-zA-Z0-9]+)/);
  if (match) {
    return {
      readerHash: match[1],
      url: `https://weread.qq.com/web/reader/${match[1]}`,
    };
  }
  if (/^[a-zA-Z0-9]{15,40}$/.test(raw)) {
    return {
      readerHash: raw,
      url: `https://weread.qq.com/web/reader/${raw}`,
    };
  }
  throw new Error(`无法识别的微信读书书籍标识: ${raw}`);
}

/**
 * Decode Base64-chunked WeRead chapter responses (e_0, e_1, e_3) into UTF-8 XHTML.
 */
export function decodeChapterChunks({ e0 = "", e1 = "", e3 = "" } = {}) {
  const parts = [];
  if (e0) {
    const body0 = e0.slice(32);
    let picked = null;
    for (let shift = 0; shift < 4; shift++) {
      const candidate = body0.slice(shift);
      if (candidate.startsWith("PD94") || candidate.startsWith("PCFET") || candidate.startsWith("PGh0")) {
        picked = candidate;
        break;
      }
    }
    parts.push(picked !== null ? picked : body0.slice(1));
  }
  if (e1) parts.push(e1.slice(32));
  if (e3) parts.push(e3.slice(32));

  const b64Raw = parts.join("");
  if (!b64Raw) return "";
  const usableLen = b64Raw.endsWith("=") ? b64Raw.length : b64Raw.length - (b64Raw.length % 4);
  const bytes = Buffer.from(b64Raw.slice(0, usableLen), "base64");
  return bytes.toString("utf-8");
}

/**
 * Decode common HTML/XML entities.
 */
export function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/**
 * Convert WeRead chapter XHTML into clean readable paragraphs.
 */
export function xhtmlToParagraphs(xhtml) {
  const bodyMatch = String(xhtml || "").match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : String(xhtml || "");
  const blocks = [];
  const blockRegex = /<(p|h[1-6]|li|blockquote|div)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRegex.exec(body)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[3]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/%[^\s<]{0,3}bsp;/gi, "");
    const clean = decodeHtmlEntities(inner)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (!clean) continue;
    if (/^h[1-6]$/.test(tag)) {
      const level = Number.parseInt(tag[1], 10);
      blocks.push(`${"#".repeat(Math.min(level + 1, 6))} ${clean}`);
    } else {
      blocks.push(clean);
    }
  }
  return blocks;
}

/**
 * Build a plain-text string paired with exact XHTML start/end character indices
 * for every visible character in the decoded XHTML.
 */
export function buildPlainTextXhtmlMap(xhtml) {
  const src = String(xhtml || "");
  let plain = "";
  const xStart = [];
  const xEnd = [];

  let i = 0;
  let inBody = src.indexOf("<body");
  if (inBody !== -1) {
    const close = src.indexOf(">", inBody);
    i = close !== -1 ? close + 1 : 0;
  }

  while (i < src.length) {
    const ch = src[i];
    if (ch === "<") {
      const gt = src.indexOf(">", i);
      if (gt === -1) break;
      i = gt + 1;
      continue;
    }
    if (ch === "&") {
      const semi = src.indexOf(";", i);
      if (semi !== -1 && semi - i <= 10) {
        const entity = src.slice(i, semi + 1);
        const decoded = decodeHtmlEntities(entity);
        for (const c of decoded) {
          plain += c;
          xStart.push(i);
          xEnd.push(semi + 1);
        }
        i = semi + 1;
        continue;
      }
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    plain += ch;
    xStart.push(i);
    xEnd.push(i + 1);
    i++;
  }

  return { plain, xStart, xEnd };
}

/**
 * Locate targetText inside decoded XHTML and calibrate offset using a /web/book/search anchor hit.
 */
export function resolveOffsetWithAnchor({ xhtml, targetText, anchorText, anchorKeywordStart }) {
  const { plain, xStart, xEnd } = buildPlainTextXhtmlMap(xhtml);
  const normTarget = String(targetText || "").trim();
  const idx = plain.indexOf(normTarget);
  if (idx === -1) {
    return null;
  }

  const localStart = xStart[idx];
  const localEnd = xEnd[idx + normTarget.length - 1];

  if (anchorText && Number.isFinite(anchorKeywordStart)) {
    const anchorPlainIdx = plain.indexOf(anchorText, Math.max(0, idx - 500));
    if (anchorPlainIdx !== -1) {
      const localAnchorStart = xStart[anchorPlainIdx];
      const drift = localAnchorStart - anchorKeywordStart;
      return {
        start: localStart - drift,
        end: localEnd - drift,
        drift,
      };
    }
  }

  return { start: localStart, end: localEnd, drift: 0 };
}

/**
 * Format exported highlights & notes into Markdown.
 */
export function formatExportMarkdown({ bookInfo, chapters = [], bookmarks = [], reviews = [], exportedAt = new Date() }) {
  const title = bookInfo?.title || "未命名书籍";
  const author = bookInfo?.author || "未知作者";
  const bookId = bookInfo?.bookId || "";
  const chapMap = new Map();
  for (const c of chapters) {
    chapMap.set(Number(c.chapterUid), c);
  }

  const reviewByRange = new Map();
  for (const r of reviews) {
    const key = `${r.chapterUid}:${r.range || ""}`;
    if (!reviewByRange.has(key)) reviewByRange.set(key, []);
    reviewByRange.get(key).push(r);
  }

  const grouped = new Map();
  for (const bm of bookmarks) {
    const uid = Number(bm.chapterUid);
    if (!grouped.has(uid)) grouped.set(uid, []);
    grouped.get(uid).push(bm);
  }

  const sortedUids = Array.from(grouped.keys()).sort((a, b) => {
    const ca = chapMap.get(a)?.chapterIdx ?? a;
    const cb = chapMap.get(b)?.chapterIdx ?? b;
    return ca - cb;
  });

  const lines = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `author: "${author.replace(/"/g, '\\"')}"`,
    `platform: weread`,
    `bookId: "${bookId}"`,
    `exportedAt: "${exportedAt.toISOString()}"`,
    `highlightCount: ${bookmarks.length}`,
    `reviewCount: ${reviews.length}`,
    "---",
    "",
    `# ${title}`,
    "",
    `- **作者**：${author}`,
    `- **平台**：微信读书 (\`bookId: ${bookId}\`)`,
    `- **划线总数**：${bookmarks.length} 条`,
    `- **想法总数**：${reviews.length} 条`,
    `- **导出时间**：${exportedAt.toLocaleString("zh-CN", { hour12: false })}`,
    "",
    "---",
    "",
  ];

  if (sortedUids.length === 0) {
    lines.push("> 本书当前暂无划线记录。");
    return lines.join("\n");
  }

  for (const uid of sortedUids) {
    const chap = chapMap.get(uid);
    const items = grouped.get(uid).slice().sort((a, b) => {
      const sa = Number.parseInt(String(a.range || "0").split("-")[0], 10) || 0;
      const sb = Number.parseInt(String(b.range || "0").split("-")[0], 10) || 0;
      return sa - sb;
    });
    const chapTitle = chap?.title || items[0]?.chapterName || `章节 ${uid}`;
    lines.push(`## ${chapTitle}`, "");

    for (const bm of items) {
      const styleLabel = STYLE_LABELS[bm.style] || `样式${bm.style ?? 0}`;
      const colorLabel = COLOR_LABELS[bm.colorStyle] || `色${bm.colorStyle ?? ""}`;
      const text = String(bm.markText || "").trim().replace(/\n+/g, "\n> ");
      lines.push(`> ${text}`, "");

      const matchedReviews = reviewByRange.get(`${uid}:${bm.range || ""}`) || [];
      for (const rv of matchedReviews) {
        if (rv.content) {
          lines.push(`- **想法**：${String(rv.content).trim()}`);
        }
      }

      const ts = bm.createTime
        ? new Date(bm.createTime * 1000).toLocaleString("zh-CN", { hour12: false })
        : "";
      lines.push(
        `- *样式*：${styleLabel}（${colorLabel}） | *范围*：\`${bm.range}\` | *ID*：\`${bm.bookmarkId}\`${ts ? ` | *时间*：${ts}` : ""}`,
        ""
      );
    }
  }

  return lines.join("\n");
}

function runLantern(lanternCli, subArgs, timeoutMs = 20000) {
  const fullArgs = [...lanternCli.argsPrefix, ...subArgs];
  const stdout = execFileSync(lanternCli.command, fullArgs, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  const parsed = JSON.parse(stdout);
  if (parsed && parsed.ok === false) {
    const code = parsed.error?.code || "lantern_error";
    const msg = parsed.error?.message || "Leo Lantern command failed";
    const err = new Error(`[${code}] ${msg}`);
    err.code = code;
    throw err;
  }
  return parsed;
}

function evalInBrowser(lanternCli, jsCode, timeoutMs = 30000) {
  const tmpFile = path.join(os.tmpdir(), `leo-novel-eval-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, jsCode, "utf-8");
  try {
    const res = runLantern(lanternCli, ["eval", "--file", tmpFile], timeoutMs);
    return res.evalResult;
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.rmSync(tmpFile, { force: true });
    }
  }
}

async function withWeReadSession({ url, keepOpen = false }, fn) {
  const lanternCli = locateLanternCli();
  if (!lanternCli.found) {
    throw new Error("未找到 leo-lantern CLI，请先安装并启用 leo-lantern Skill。");
  }

  runLantern(lanternCli, ["start"], 20000);
  runLantern(lanternCli, ["start-task", "--title", "leo-novel-weread"], 20000);

  try {
    runLantern(lanternCli, ["goto", url], 25000);
    runLantern(lanternCli, ["wait", "--idle", "--idle-ms", "1500"], 20000);

    const loginCheck = evalInBrowser(
      lanternCli,
      `(() => {
        const hasLoginBtn = Array.from(document.querySelectorAll('button, a')).some(el => /登录/.test(el.innerText || ''));
        const hasUserAvatar = Boolean(document.querySelector('.wr_avatar, .readerTopBar_avatar, img[src*="wx.qlogo.cn"]'));
        const isReader = location.pathname.includes('/web/reader/');
        const perfBook = performance.getEntriesByType('resource').find(r => r.name.includes('bookId='));
        const bookId = perfBook ? new URL(perfBook.name).searchParams.get('bookId') : null;
        return {
          url: location.href,
          title: document.title,
          hasLoginBtn,
          hasUserAvatar,
          isReader,
          bookId
        };
      })()`
    );

    if (loginCheck.hasLoginBtn && !loginCheck.hasUserAvatar) {
      const err = new Error("微信读书当前未登录（login_required），请先在 Chrome 中打开 https://weread.qq.com/ 扫码登录后重试。");
      err.code = "login_required";
      throw err;
    }

    return await fn(lanternCli, loginCheck);
  } finally {
    if (!keepOpen) {
      try {
        runLantern(lanternCli, ["end-task", "--close-group"], 10000);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

async function resolveBookContext(lanternCli, loginCheck) {
  return evalInBrowser(
    lanternCli,
    `(async () => {
      let bookId = ${JSON.stringify(loginCheck.bookId)};
      if (!bookId) {
        const perf = performance.getEntriesByType('resource').find(r => r.name.includes('bookId='));
        if (perf) bookId = new URL(perf.name).searchParams.get('bookId');
      }
      if (!bookId) {
        throw new Error('无法从当前阅读页解析 bookId');
      }
      const signedGet = async (endpoint, queryObj) => {
        const qs = new URLSearchParams(queryObj).toString();
        const sr = await window.__WRPA__.sr({ query: qs });
        const resp = await fetch(endpoint + (qs ? '?' + qs : ''), {
          headers: { 'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr) }
        });
        return resp.json();
      };
      const signedPost = async (endpoint, bodyObj) => {
        const sr = await window.__WRPA__.sr({ body: bodyObj });
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Accept': 'application/json, text/plain, */*',
            'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr)
          },
          body: JSON.stringify(bodyObj)
        });
        return resp.json();
      };
      const [info, chapRes] = await Promise.all([
        signedGet('/web/book/info', { bookId }),
        signedPost('/web/book/chapterInfos', { bookIds: [bookId] })
      ]);
      const chapters = chapRes?.data?.[0]?.updated || [];
      return {
        bookId,
        bookInfo: info,
        chapters,
        currentChapterTitle: document.querySelector('.readerTopBar_title_chapter')?.innerText?.trim() || ''
      };
    })()`
  );
}

function matchChapter(chapters, selector) {
  if (selector === undefined || selector === null || selector === "") return null;
  const raw = String(selector).trim();
  const byUid = chapters.find((c) => String(c.chapterUid) === raw);
  if (byUid) return byUid;
  const byIdx = chapters.find((c) => String(c.chapterIdx) === raw);
  if (byIdx) return byIdx;
  const lower = raw.toLowerCase();
  return chapters.find((c) => String(c.title || "").toLowerCase().includes(lower)) || null;
}

async function cmdShelf(args) {
  return withWeReadSession({ url: "https://weread.qq.com/web/shelf", keepOpen: Boolean(args["keep-open"]) }, async (lanternCli) => {
    const books = evalInBrowser(
      lanternCli,
      `(() => {
        return Array.from(document.querySelectorAll('a.shelfBook'))
          .filter(a => a.getAttribute('href')?.includes('/web/reader/'))
          .map(a => {
            const titleDiv = a.querySelector('.title, [title]');
            const img = a.querySelector('img');
            const srcMatch = img?.src?.match(/(\\d{5,})/);
            return {
              title: titleDiv?.getAttribute('title') || titleDiv?.innerText?.trim() || '',
              readerHash: a.getAttribute('href').split('/').pop(),
              url: a.href,
              bookIdHint: srcMatch ? srcMatch[1] : null
            };
          });
      })()`
    );
    const q = args.query ? String(args.query).toLowerCase() : null;
    const filtered = q ? books.filter((b) => b.title.toLowerCase().includes(q)) : books;
    return { ok: true, count: filtered.length, books: filtered };
  });
}

async function cmdToc(args) {
  const { url } = parseBookInput(args.book);
  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli, loginCheck) => {
    const ctx = await resolveBookContext(lanternCli, loginCheck);
    return {
      ok: true,
      bookId: ctx.bookId,
      title: ctx.bookInfo?.title,
      author: ctx.bookInfo?.author,
      version: ctx.bookInfo?.version,
      currentChapterTitle: ctx.currentChapterTitle,
      chapters: ctx.chapters.map((c) => ({
        chapterIdx: c.chapterIdx,
        chapterUid: c.chapterUid,
        title: c.title,
        wordCount: c.wordCount,
        level: c.level,
        paid: c.paid,
      })),
    };
  });
}

async function captureChapterXhtml(lanternCli, ctx, targetChapter) {
  const targetTitle = targetChapter ? targetChapter.title : ctx.currentChapterTitle;
  const catalogList = evalInBrowser(
    lanternCli,
    `(() => {
      return Array.from(document.querySelectorAll('.readerCatalog_list_item')).map((el, index) => ({
        index,
        text: (el.querySelector('.readerCatalog_list_item_title_text')?.innerText || el.innerText || '').trim(),
        selected: el.className.includes('selected'),
        disabled: el.className.includes('disabled')
      }));
    })()`
  );

  let targetIdx = catalogList.findIndex((c) => !c.disabled && c.text === targetTitle);
  if (targetIdx === -1 && targetTitle) {
    targetIdx = catalogList.findIndex((c) => !c.disabled && c.text.includes(targetTitle));
  }
  if (targetIdx === -1) {
    targetIdx = catalogList.findIndex((c) => c.selected && !c.disabled);
  }
  if (targetIdx === -1) {
    throw new Error(`目录中未找到可阅读的章节: ${targetTitle}`);
  }

  const isAlreadySelected = catalogList[targetIdx].selected;
  const altIdx = catalogList.findIndex((c, i) => i !== targetIdx && !c.disabled);

  evalInBrowser(
    lanternCli,
    `(() => {
      window.__leoNovelCap = { chunks: {}, blockRead: true };
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__lnUrl = url;
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        if (window.__leoNovelCap.blockRead && this.__lnUrl && this.__lnUrl.includes('/web/book/read')) {
          Object.defineProperty(this, 'readyState', { value: 4 });
          Object.defineProperty(this, 'status', { value: 200 });
          Object.defineProperty(this, 'responseText', { value: '{"succ":1}' });
          Object.defineProperty(this, 'response', { value: '{"succ":1}' });
          setTimeout(() => { this.onreadystatechange && this.onreadystatechange(); this.onload && this.onload(); }, 5);
          return;
        }
        this.addEventListener('load', () => {
          if (this.__lnUrl && this.__lnUrl.includes('/web/book/chapter/e_')) {
            const part = this.__lnUrl.split('/').pop();
            let cKey = 'default';
            try { cKey = JSON.parse(body || '{}').c || 'default'; } catch {}
            window.__leoNovelCap.chunks[part + '_' + cKey] = { part, cKey, res: this.responseText };
          }
        });
        return origSend.apply(this, arguments);
      };
      return true;
    })()`
  );

  const clickCatalogAt = (idx) => {
    runLantern(lanternCli, ["click", "--sel", ".readerControls_item.catalog"], 10000);
    runLantern(lanternCli, ["wait", "--idle", "--idle-ms", "400"], 10000);
    evalInBrowser(
      lanternCli,
      `(() => {
        document.querySelectorAll('[data-leo-cat-target]').forEach(el => el.removeAttribute('data-leo-cat-target'));
        const item = document.querySelectorAll('.readerCatalog_list_item')[${idx}];
        if (!item) throw new Error('Catalog item missing');
        item.scrollIntoView({ block: 'center' });
        const inner = item.querySelector('.readerCatalog_list_item_inner') || item;
        inner.setAttribute('data-leo-cat-target', '1');
        return true;
      })()`
    );
    runLantern(lanternCli, ["click", "--sel", "[data-leo-cat-target='1']"], 10000);
    runLantern(lanternCli, ["wait", "--idle", "--idle-ms", "1500"], 20000);
  };

  if (isAlreadySelected && altIdx !== -1) {
    clickCatalogAt(altIdx);
    evalInBrowser(lanternCli, `(() => { window.__leoNovelCap.chunks = {}; return true; })()`);
  }
  clickCatalogAt(targetIdx);

  const captured = evalInBrowser(
    lanternCli,
    `(() => {
      window.__leoNovelCap.blockRead = false;
      const all = Object.values(window.__leoNovelCap.chunks);
      const findPart = (p) => all.find(x => x.part === p)?.res || '';
      return {
        chapterTitle: document.querySelector('.readerTopBar_title_chapter')?.innerText?.trim() || '',
        e0: findPart('e_0'),
        e1: findPart('e_1'),
        e3: findPart('e_3')
      };
    })()`
  );

  const xhtml = decodeChapterChunks({ e0: captured.e0, e1: captured.e1, e3: captured.e3 });
  const paragraphs = xhtmlToParagraphs(xhtml);
  return {
    chapterTitle: captured.chapterTitle || targetTitle,
    xhtml,
    paragraphs,
    text: paragraphs.join("\n\n"),
  };
}

async function cmdRead(args) {
  const { url } = parseBookInput(args.book);
  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli, loginCheck) => {
    const ctx = await resolveBookContext(lanternCli, loginCheck);
    const targetChap = args.chapter ? matchChapter(ctx.chapters, args.chapter) : matchChapter(ctx.chapters, ctx.currentChapterTitle);
    const res = await captureChapterXhtml(lanternCli, ctx, targetChap);

    let savedPath = null;
    if (args.save) {
      const dest = resolveBookDestination({
        bookTitle: ctx.bookInfo?.title || "未命名书籍",
        kind: "chapter",
        chapterTitle: res.chapterTitle,
        chapterIdx: targetChap?.chapterIdx ?? null,
        explicitOutputDir: args.dir || null,
      });
      fs.mkdirSync(dest.targetDir, { recursive: true });
      const md = `# ${res.chapterTitle}\n\n> 所属书籍：${ctx.bookInfo?.title || ""}（${ctx.bookInfo?.author || ""}）\n\n---\n\n${res.text}\n`;
      fs.writeFileSync(dest.targetPath, md, "utf-8");
      savedPath = dest.targetPath;
    }

    return {
      ok: true,
      bookId: ctx.bookId,
      bookTitle: ctx.bookInfo?.title,
      chapterUid: targetChap?.chapterUid ?? null,
      chapterIdx: targetChap?.chapterIdx ?? null,
      chapterTitle: res.chapterTitle,
      paragraphCount: res.paragraphs.length,
      savedPath,
      text: res.text,
    };
  });
}

async function searchBookApi(lanternCli, bookId, keyword, count = 10) {
  return evalInBrowser(
    lanternCli,
    `(async () => {
      const params = new URLSearchParams({
        bookId: ${JSON.stringify(String(bookId))},
        keyword: ${JSON.stringify(String(keyword))},
        maxIdx: '0',
        count: ${JSON.stringify(String(count))},
        fragmentSize: '150',
        onlyCount: '0'
      }).toString();
      const sr = await window.__WRPA__.sr({ query: params });
      const resp = await fetch('/web/book/search?' + params, {
        headers: { 'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr) }
      });
      return resp.json();
    })()`
  );
}

async function cmdSearch(args) {
  const { url } = parseBookInput(args.book);
  if (!args.keyword) throw new Error("请通过 --keyword 指定搜索关键词");
  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli, loginCheck) => {
    const ctx = await resolveBookContext(lanternCli, loginCheck);
    const data = await searchBookApi(lanternCli, ctx.bookId, args.keyword, Number(args.count || 10));
    const chapMap = new Map(ctx.chapters.map((c) => [Number(c.chapterUid), c.title]));
    return {
      ok: true,
      bookId: ctx.bookId,
      bookTitle: ctx.bookInfo?.title,
      keyword: args.keyword,
      hasMore: Boolean(data?.hasMore),
      results: (data?.result || []).map((r) => ({
        chapterUid: r.chapterUid,
        chapterTitle: chapMap.get(Number(r.chapterUid)) || "",
        abstract: String(r.abstract || "").trim(),
        absStart: r.absStart,
        absEnd: r.absEnd,
        keywordStart: r.keywordStart,
      })),
    };
  });
}

async function cmdBookmarks(args) {
  const { url } = parseBookInput(args.book);
  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli, loginCheck) => {
    const ctx = await resolveBookContext(lanternCli, loginCheck);
    const bmRes = evalInBrowser(
      lanternCli,
      `(async () => {
        const qs = new URLSearchParams({ bookId: ${JSON.stringify(String(ctx.bookId))} }).toString();
        const sr = await window.__WRPA__.sr({ query: qs });
        const resp = await fetch('/web/book/bookmarklist?' + qs, {
          headers: { 'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr) }
        });
        return resp.json();
      })()`
    );
    let items = bmRes?.updated || [];
    if (args.chapter !== undefined) {
      const targetChap = matchChapter(ctx.chapters, args.chapter);
      const targetUid = targetChap ? Number(targetChap.chapterUid) : Number(args.chapter);
      items = items.filter((b) => Number(b.chapterUid) === targetUid);
    }
    return {
      ok: true,
      bookId: ctx.bookId,
      bookTitle: ctx.bookInfo?.title,
      count: items.length,
      bookmarks: items,
    };
  });
}

async function cmdHighlight(args) {
  const { url } = parseBookInput(args.book);
  const targetText = String(args.text || "").trim();
  if (!targetText) throw new Error("请通过 --text 指定要划线的原文片段");

  const config = readConfig();
  const style = args.style !== undefined ? Number(args.style) : config.default_highlight_style;
  const colorStyle = args.color !== undefined ? Number(args.color) : config.default_highlight_color;

  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli, loginCheck) => {
    const ctx = await resolveBookContext(lanternCli, loginCheck);
    const targetChapHint = args.chapter ? matchChapter(ctx.chapters, args.chapter) : null;

    // Step 1: Try exact dual-anchor search via /web/book/search
    const cleanTokens = targetText.replace(/\s+/g, " ").trim();
    const startAnchor = cleanTokens.length <= 16 ? cleanTokens : cleanTokens.slice(0, 12).trim();
    const endAnchor = cleanTokens.length <= 16 ? cleanTokens : cleanTokens.slice(-12).trim();

    const startRes = await searchBookApi(lanternCli, ctx.bookId, startAnchor, 20);
    let startHits = startRes?.result || [];
    if (targetChapHint) {
      startHits = startHits.filter((h) => Number(h.chapterUid) === Number(targetChapHint.chapterUid));
    }

    let resolved = null;

    if (startHits.length > 0 && cleanTokens === startAnchor) {
      const hit = startHits[0];
      resolved = {
        chapterUid: Number(hit.chapterUid),
        start: Number(hit.keywordStart),
        end: Number(hit.keywordStart) + startAnchor.length,
        method: "single-anchor",
      };
    } else if (startHits.length > 0) {
      const endRes = await searchBookApi(lanternCli, ctx.bookId, endAnchor, 20);
      const endHits = (endRes?.result || []).filter((eHit) =>
        startHits.some((sHit) => Number(sHit.chapterUid) === Number(eHit.chapterUid))
      );

      for (const sHit of startHits) {
        const matchedEnd = endHits.find(
          (eHit) =>
            Number(eHit.chapterUid) === Number(sHit.chapterUid) &&
            Number(eHit.keywordStart) >= Number(sHit.keywordStart) &&
            Number(eHit.keywordStart) - Number(sHit.keywordStart) <= targetText.length + 250
        );
        if (matchedEnd) {
          resolved = {
            chapterUid: Number(sHit.chapterUid),
            start: Number(sHit.keywordStart),
            end: Number(matchedEnd.keywordStart) + endAnchor.length,
            method: "dual-anchor",
          };
          break;
        }
      }
    }

    // Step 2: Fallback to chapter XHTML decode + search-anchor calibration
    if (!resolved) {
      const fallbackAnchor = cleanTokens.slice(0, Math.min(12, cleanTokens.length)).trim();
      const anchorHits = (await searchBookApi(lanternCli, ctx.bookId, fallbackAnchor, 20))?.result || [];
      const candidateUid = targetChapHint
        ? Number(targetChapHint.chapterUid)
        : anchorHits[0]
          ? Number(anchorHits[0].chapterUid)
          : null;
      const chapObj = candidateUid ? ctx.chapters.find((c) => Number(c.chapterUid) === candidateUid) : null;
      if (!chapObj) {
        throw new Error(`未能在全书检索到文本片段: "${targetText.slice(0, 30)}..."`);
      }
      const chapData = await captureChapterXhtml(lanternCli, ctx, chapObj);
      const anchorHit = anchorHits.find((h) => Number(h.chapterUid) === candidateUid);
      const off = resolveOffsetWithAnchor({
        xhtml: chapData.xhtml,
        targetText,
        anchorText: anchorHit ? fallbackAnchor : null,
        anchorKeywordStart: anchorHit ? Number(anchorHit.keywordStart) : NaN,
      });
      if (!off) {
        throw new Error(`在章节 "${chapObj.title}" 中未匹配到精确文本: "${targetText.slice(0, 30)}..."`);
      }
      resolved = {
        chapterUid: candidateUid,
        start: off.start,
        end: off.end,
        method: "xhtml-anchor",
      };
    }

    const chapMeta = ctx.chapters.find((c) => Number(c.chapterUid) === resolved.chapterUid);
    const rangeStr = `${resolved.start}-${resolved.end}`;
    const markTextB64 = Buffer.from(targetText, "utf-8").toString("base64");

    const payload = {
      bookId: String(ctx.bookId),
      chapterUid: resolved.chapterUid,
      chapterIdx: chapMeta?.chapterIdx ?? resolved.chapterUid,
      bookVersion: ctx.bookInfo?.version,
      type: 1,
      style,
      colorStyle,
      range: rangeStr,
      markText: markTextB64,
    };

    const apiRes = evalInBrowser(
      lanternCli,
      `(async () => {
        const body = ${JSON.stringify(payload)};
        const sr = await window.__WRPA__.sr({ body });
        const resp = await fetch('/web/book/addBookmark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Accept': 'application/json, text/plain, */*',
            'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr)
          },
          body: JSON.stringify(body)
        });
        return resp.json();
      })()`
    );

    if (!apiRes?.bookmarkId) {
      throw new Error(`addBookmark 返回异常: ${JSON.stringify(apiRes)}`);
    }

    return {
      ok: true,
      bookmarkId: apiRes.bookmarkId,
      bookId: ctx.bookId,
      bookTitle: ctx.bookInfo?.title,
      chapterUid: resolved.chapterUid,
      chapterTitle: chapMeta?.title || "",
      range: rangeStr,
      style,
      colorStyle,
      method: resolved.method,
      markText: targetText,
    };
  });
}

async function cmdUpdateHighlight(args) {
  const { url } = parseBookInput(args.book);
  const bookmarkId = String(args["bookmark-id"] || "").trim();
  if (!bookmarkId) throw new Error("请通过 --bookmark-id 指定划线 ID");

  const config = readConfig();
  const style = args.style !== undefined ? Number(args.style) : config.default_highlight_style;
  const colorStyle = args.color !== undefined ? Number(args.color) : config.default_highlight_color;

  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli) => {
    const payload = { bookmarkId, style, colorStyle };
    const apiRes = evalInBrowser(
      lanternCli,
      `(async () => {
        const body = ${JSON.stringify(payload)};
        const sr = await window.__WRPA__.sr({ body });
        const resp = await fetch('/web/book/updateBookmark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Accept': 'application/json, text/plain, */*',
            'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr)
          },
          body: JSON.stringify(body)
        });
        return resp.json();
      })()`
    );
    return { ok: apiRes?.succ === 1, bookmarkId, style, colorStyle, response: apiRes };
  });
}

async function cmdRemoveHighlight(args) {
  const { url } = parseBookInput(args.book);
  const bookmarkId = String(args["bookmark-id"] || "").trim();
  if (!bookmarkId) throw new Error("请通过 --bookmark-id 指定要删除的划线 ID");

  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli) => {
    const payload = { bookmarkId };
    const apiRes = evalInBrowser(
      lanternCli,
      `(async () => {
        const body = ${JSON.stringify(payload)};
        const sr = await window.__WRPA__.sr({ body });
        const resp = await fetch('/web/book/removeBookmark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Accept': 'application/json, text/plain, */*',
            'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr)
          },
          body: JSON.stringify(body)
        });
        return resp.json();
      })()`
    );
    return { ok: apiRes?.succ === 1, bookmarkId, response: apiRes };
  });
}

async function cmdExport(args) {
  const { url } = parseBookInput(args.book);
  return withWeReadSession({ url, keepOpen: Boolean(args["keep-open"]) }, async (lanternCli, loginCheck) => {
    const ctx = await resolveBookContext(lanternCli, loginCheck);
    const data = evalInBrowser(
      lanternCli,
      `(async () => {
        const signedGet = async (endpoint, queryObj) => {
          const qs = new URLSearchParams(queryObj).toString();
          const sr = await window.__WRPA__.sr({ query: qs });
          const resp = await fetch(endpoint + '?' + qs, {
            headers: { 'x-wrpa-0': Array.isArray(sr) ? sr.join(',') : String(sr) }
          });
          return resp.json();
        };
        const [bmRes, rvRes] = await Promise.all([
          signedGet('/web/book/bookmarklist', { bookId: ${JSON.stringify(String(ctx.bookId))} }),
          signedGet('/web/review/list', {
            bookId: ${JSON.stringify(String(ctx.bookId))},
            listType: '11',
            maxIdx: '0',
            count: '0',
            listMode: '2',
            synckey: '0',
            mine: '1'
          })
        ]);
        return {
          bookmarks: bmRes?.updated || [],
          reviews: rvRes?.reviews?.map(r => r.review || r) || []
        };
      })()`
    );

    const exportedAt = new Date();
    const md = formatExportMarkdown({
      bookInfo: ctx.bookInfo,
      chapters: ctx.chapters,
      bookmarks: data.bookmarks,
      reviews: data.reviews,
      exportedAt,
    });

    const dest = resolveBookDestination({
      bookTitle: ctx.bookInfo?.title || "未命名书籍",
      kind: "notes",
      explicitOutputDir: args.dir || null,
      explicitFilename: args.filename || null,
      date: exportedAt,
    });
    fs.mkdirSync(dest.targetDir, { recursive: true });
    fs.writeFileSync(dest.targetPath, md, "utf-8");

    return {
      ok: true,
      bookId: ctx.bookId,
      bookTitle: ctx.bookInfo?.title,
      highlightCount: data.bookmarks.length,
      reviewCount: data.reviews.length,
      bookDir: dest.bookDir,
      outputPath: dest.targetPath,
    };
  });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  const handlers = {
    shelf: cmdShelf,
    toc: cmdToc,
    read: cmdRead,
    search: cmdSearch,
    bookmarks: cmdBookmarks,
    highlight: cmdHighlight,
    "update-highlight": cmdUpdateHighlight,
    "remove-highlight": cmdRemoveHighlight,
    export: cmdExport,
  };

  if (!cmd || !handlers[cmd]) {
    console.error(
      "用法: node scripts/weread.mjs <shelf|toc|read|search|bookmarks|highlight|update-highlight|remove-highlight|export> [options]"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await handlers[cmd](args);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, code: err.code || "error", message: err.message }, null, 2));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
