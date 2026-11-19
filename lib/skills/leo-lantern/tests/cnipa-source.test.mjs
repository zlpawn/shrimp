import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseCliArgs,
  resolveOutputDir,
  normalizeCnipaDate,
  computeJitterMs,
  splitDateRange,
  splitDateRangeByMonth,
  buildDateSlices,
  deduplicateAndMerge,
  buildIndexPayload,
  buildAdvancedPayload,
  buildSwListPayload,
  generateMarkdown
} from "../recipes/cnipa-source.mjs";
import { startFakeExtension } from "./fake-extension.mjs";

const RECIPE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../recipes/cnipa-source.mjs");
const PNG_BASE64 = Buffer.from("fake-jpg-bytes").toString("base64");

async function runCnipaRecipe(args, handler) {
  const fake = await startFakeExtension(handler);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-cnipa-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-cnipa-home-"));
  try {
    const result = await new Promise((resolve) => {
      const child = spawn("node", [RECIPE_PATH, ...args, "--out", outDir], {
        env: {
          ...process.env,
          LEO_LANTERN_PORT: String(fake.port),
          HOME: homeDir,
          USERPROFILE: homeDir
        }
      });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      child.on("exit", (code) => resolve({ code, out }));
    });
    return { ...result, commands: fake.commands, outDir };
  } finally {
    await fake.stop();
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

describe("cnipa-source pure helpers", () => {
  test("normalizeCnipaDate normalizes separators and compact digits", () => {
    assert.equal(normalizeCnipaDate("2026-11-17"), "2026.11.17");
    assert.equal(normalizeCnipaDate("20261117"), "2026.11.17");
    assert.equal(normalizeCnipaDate("2026/11/17"), "2026.11.17");
    assert.throws(() => normalizeCnipaDate("not-a-date"), /日期格式无效/);
  });

  test("computeJitterMs scales between 1.0x and 1.6x base delay", () => {
    assert.equal(computeJitterMs(0), 0);
    assert.equal(computeJitterMs(3000, () => 0), 3000);
    assert.equal(computeJitterMs(3000, () => 1), 4800);
    assert.equal(computeJitterMs(3000, () => 0.5), 3900);
  });

  test("splitDateRange and splitDateRangeByMonth split inclusively without gaps", () => {
    assert.deepEqual(splitDateRange("2026.01.01", "2026.01.10", 4), [
      { begin: "2026.01.01", end: "2026.01.04" },
      { begin: "2026.01.05", end: "2026.01.08" },
      { begin: "2026.01.09", end: "2026.01.10" }
    ]);
    assert.deepEqual(splitDateRangeByMonth("2026.01.15", "2026.03.10"), [
      { begin: "2026.01.15", end: "2026.01.31" },
      { begin: "2026.02.01", end: "2026.02.28" },
      { begin: "2026.03.01", end: "2026.03.10" }
    ]);
    assert.throws(() => splitDateRange("2026.02.01", "2026.01.01", 10), /不能晚于/);
  });

  test("deduplicateAndMerge skips duplicates by pn and re-indexes", () => {
    const res = deduplicateAndMerge(
      [
        { pn: "CN123A", title: "dup" },
        { pn: "CN456A", title: "new1" },
        { pn: "cn456a", title: "dup-in-batch" }
      ],
      [{ index: 1, pn: "CN123A", title: "old" }]
    );
    assert.equal(res.added.length, 1);
    assert.equal(res.added[0].pn, "CN456A");
    assert.equal(res.skippedDuplicates, 2);
    assert.equal(res.merged.length, 2);
    assert.deepEqual(res.merged.map((m) => m.index), [1, 2]);
  });

  test("parseCliArgs infers modes and validates inputs", () => {
    const s = parseCliArgs(["--query", "人工智能", "--limit", "5"]);
    assert.equal(s.mode, "search");
    assert.equal(s.query, "人工智能");
    assert.equal(s.limit, 5);
    assert.equal(s.deep, false);
    assert.equal(s.withThumb, false);
    assert.equal(s.delayMs, 3000);

    const a = parseCliArgs(["--applicant", "华为", "--title", "大模型", "--ad-begin", "2025-01-01", "--ad-end", "2025-02-01", "--slice-days", "15"]);
    assert.equal(a.mode, "advanced");
    assert.equal(a.adBegin, "2025.01.01");
    assert.equal(buildDateSlices(a).length, 3);

    const d = parseCliArgs(["https://epub.cnipa.gov.cn/patent/CN123115842A"]);
    assert.equal(d.mode, "detail");
    assert.equal(d.pn, "CN123115842A");
    assert.equal(d.deep, true);
    assert.equal(d.downloadPages, true);
    assert.equal(d.withThumb, true);

    const dSkip = parseCliArgs(["--mode", "detail", "--pn", "CN123115842A", "--skip-media"]);
    assert.equal(dSkip.downloadPages, false);
    assert.equal(dSkip.withThumb, false);

    const sPages = parseCliArgs(["--query", "人工智能", "--download-pages"]);
    assert.equal(sPages.deep, true);
    assert.equal(sPages.withThumb, true);

    const sw = parseCliArgs(["--sw-pubdate", "2026-11-17", "--an", "2024115380488"]);
    assert.equal(sw.mode, "sw");
    assert.equal(sw.swPubdate, "2026.11.17");

    assert.throws(() => parseCliArgs(["--mode", "search"]), /search 模式/);
    assert.throws(() => parseCliArgs(["--mode", "advanced"]), /advanced 模式/);
    assert.throws(() => parseCliArgs(["--mode", "detail"]), /detail 模式/);
    assert.throws(() => parseCliArgs(["--mode", "sw"]), /sw 模式/);
    assert.throws(() => parseCliArgs(["--query", "AI", "--sort", "bad"]), /--sort 无效/);
    assert.throws(() => parseCliArgs(["--query", "AI", "--pubtype", "99"]), /--pubtype 无效/);
    assert.throws(() => parseCliArgs(["--applicant", "华为", "--slice-days", "10"]), /时间切片/);
  });

  test("resolveOutputDir defaults to ~/素材/patents and ignores env vars", () => {
    const prevEnv = process.env.LEO_LANTERN_CNIPA_OUT;
    process.env.LEO_LANTERN_CNIPA_OUT = "/tmp/should-be-ignored";
    try {
      const cfgPath = path.join(os.homedir(), ".shrimp", "skills", "leo-lantern", "cnipa-source-config.json");
      if (!fs.existsSync(cfgPath)) {
        assert.equal(resolveOutputDir(""), path.join(os.homedir(), "素材", "patents"));
      } else {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        assert.notEqual(resolveOutputDir(""), "/tmp/should-be-ignored");
        if (!cfg.output_dir) {
          assert.equal(resolveOutputDir(""), path.join(os.homedir(), "素材", "patents"));
        }
      }
    } finally {
      if (prevEnv === undefined) delete process.env.LEO_LANTERN_CNIPA_OUT;
      else process.env.LEO_LANTERN_CNIPA_OUT = prevEnv;
    }
  });

  test("payload builders match CNIPA form field contracts", () => {
    const opts = parseCliArgs(["--applicant", "测试公司", "--title", "电池", "--types", "fmgb,fmsq"]);
    const adv = buildAdvancedPayload(opts, "tok123");
    assert.equal(adv.isFmgb, "true");
    assert.equal(adv.isFmsq, "true");
    assert.equal(adv.isXx, "false");
    assert.equal(adv.isWg, "false");
    assert.equal(adv["catalogInfo.E71_73"], "测试公司");
    assert.equal(adv["catalogInfo.Ti"], "电池");
    assert.equal(adv.__RequestVerificationToken, "tok123");

    const idxOpts = parseCliArgs(["--query", "芯片"]);
    const idx = buildIndexPayload(idxOpts, "tok456");
    assert.equal(idx.searchStr, "芯片");
    assert.equal(idx.fmgb, "true");
    assert.equal(idx.__RequestVerificationToken, "tok456");

    const swOpts = parseCliArgs(["--mode", "sw", "--an", "2024115380488", "--sw-pubdate", "2026-11-17"]);
    const sw = buildSwListPayload(swOpts, "tok789");
    assert.equal(sw.trsSql, "申请号='2024115380488%' and 法律状态公告日='2026.11.17'");
  });

  test("generateMarkdown formats patent facts cleanly", () => {
    const md = generateMarkdown({
      target: "人工智能",
      mode: "search",
      total_count: 1,
      total_media_files: 0,
      fetched_at: "2026-11-19T12:00:00.000Z",
      patents: [
        {
          index: 1,
          patent_type: "发明公布",
          title: "一种人工智能方法",
          pn: "CN123115842A",
          pd: "2026.11.17",
          an: "2024115380488",
          ad: "2024.10.31",
          applicant: "测试研究院",
          inventor: "张三",
          ipc: ["G06F18/24"],
          abstract: "摘要正文",
          transactions: [{ sw_pubdate: "2026.11.17", sw_type: "公布" }]
        }
      ]
    });
    assert.match(md, /CN123115842A/);
    assert.match(md, /一种人工智能方法/);
    assert.match(md, /测试研究院/);
    assert.match(md, /摘要正文/);
    assert.match(md, /\*\*2026\.11\.17\*\* \| 公布/);
  });
});

describe("cnipa-source CLI integration with fake extension", () => {
  test("invalid arguments abort before touching browser", async () => {
    const r = await runCnipaRecipe(["--mode", "search"], () => ({}));
    assert.equal(r.code, 1);
    assert.deepEqual(r.commands, []);
    fs.rmSync(r.outDir, { recursive: true, force: true });
  });

  test("search + deep + --with-thumb saves JSON, Markdown, and media", async () => {
    const r = await runCnipaRecipe(["--query", "人工智能", "--deep", "--with-thumb", "--delay-ms", "0", "--limit", "1"], (cmd) => {
      if (cmd.type === "tabs.list") return [];
      if (cmd.type === "page.eval") {
        const s = cmd.params.script;
        if (s.includes("tokenLen")) {
          return { evalResult: { ready: true, url: "http://epub.cnipa.gov.cn/", tokenLen: 120 } };
        }
        if (s.includes("/Dxb/IndexQuery")) {
          return {
            evalResult: {
              ok: true,
              token: "tok-next",
              totalCount: 100,
              totalPages: 10,
              items: [
                {
                  patent_type: "发明公布",
                  title: "一种基于人工智能的测试专利",
                  pn: "CN123115842A",
                  pd: "2026.11.17",
                  an: "2024115380488",
                  ad: "2024.10.31",
                  applicant: "测试公司",
                  inventor: "李四",
                  address: "北京市海淀区",
                  ipc: ["G06F18/24"],
                  agency: "测试代理所",
                  agent: "王五",
                  abstract: "完整专利摘要内容",
                  detail_url: "http://epub.cnipa.gov.cn/patent/CN123115842A",
                  thumb_url: "http://epub.cnipa.gov.cn/imgs/test_thumb.jpg",
                  detail_handle: { fn: "zl_xm", anToken: "encAn==", pubType: "3", ggr: "20261117" }
                }
              ]
            }
          };
        }
        if (s.includes("/Sw/SwDetail")) {
          return {
            evalResult: {
              ok: true,
              detail_title: "一种基于人工智能的测试专利【2024115380488】",
              versions: [{ id: "20261117_2024115380488", label: "发明公布", an: "2024115380488", ifs: "ifsHandle", pdf: "pdfHandle" }],
              seqLinks: [],
              transactions: [{ sw_type: "公布", sw_pubdate: "2026.11.17", status: "公布" }]
            }
          };
        }
        if (s.includes("btoa(bin)")) {
          return { evalResult: { ok: true, contentType: "image/jpeg", base64: PNG_BASE64 } };
        }
      }
      return {};
    });

    try {
      assert.equal(r.code, 0, r.out);
      const subdirs = fs.readdirSync(r.outDir);
      assert.equal(subdirs.length, 1);
      const sessionDir = path.join(r.outDir, subdirs[0]);
      const jsonFile = path.join(sessionDir, "专利事实.json");
      const mdFile = path.join(sessionDir, "专利事实.md");
      assert.equal(fs.existsSync(jsonFile), true);
      assert.equal(fs.existsSync(mdFile), true);

      const saved = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
      assert.equal(saved.platform, "CNIPA");
      assert.equal(saved.total_count, 100);
      assert.equal(saved.patents.length, 1);
      assert.equal(saved.patents[0].pn, "CN123115842A");
      assert.equal(saved.patents[0].transactions[0].sw_type, "公布");
      assert.equal(saved.patents[0].versions[0].ifs, "ifsHandle");
      assert.equal(saved.total_media_files, 1);
      assert.equal(fs.existsSync(saved.patents[0].thumb_file.file_path), true);
    } finally {
      fs.rmSync(r.outDir, { recursive: true, force: true });
    }
  });

  test("time slices trigger circuit breaker on HTTP 400 and preserve collected patents", async () => {
    let queryCalls = 0;
    const r = await runCnipaRecipe(
      ["--mode", "advanced", "--applicant", "华为", "--pd-begin", "2026-01-01", "--pd-end", "2026-01-20", "--slice-days", "10", "--delay-ms", "0"],
      (cmd) => {
        if (cmd.type === "tabs.list") return [];
        if (cmd.type === "page.eval") {
          const s = cmd.params.script;
          if (s.includes("tokenLen")) {
            return { evalResult: { ready: true, url: "http://epub.cnipa.gov.cn/Advanced", tokenLen: 120 } };
          }
          if (s.includes("/Dxb/AdvancedQuery")) {
            queryCalls += 1;
            if (queryCalls === 1) {
              return {
                evalResult: {
                  ok: true,
                  token: "tok-1",
                  totalCount: 5,
                  totalPages: 1,
                  items: [{ patent_type: "发明公布", title: "切片1专利", pn: "CN111A", an: "202610001" }]
                }
              };
            }
            return { evalResult: { ok: false, blocked: true, status: 400, error: "HTTP 400 on /Dxb/AdvancedQuery" } };
          }
        }
        return {};
      }
    );

    try {
      assert.equal(r.code, 0, r.out);
      const subdirs = fs.readdirSync(r.outDir);
      assert.equal(subdirs.length, 1);
      const saved = JSON.parse(fs.readFileSync(path.join(r.outDir, subdirs[0], "专利事实.json"), "utf8"));
      assert.equal(saved.circuit_broken, true);
      assert.match(saved.circuit_break_reason, /400/);
      assert.equal(saved.patents.length, 1);
      assert.equal(saved.patents[0].pn, "CN111A");
    } finally {
      fs.rmSync(r.outDir, { recursive: true, force: true });
    }
  });

  test("incremental deduplication merges into --dedup-file without duplicating pn", async () => {
    const dedupDir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-cnipa-dedup-"));
    const dedupFile = path.join(dedupDir, "master.json");
    fs.writeFileSync(dedupFile, JSON.stringify({
      platform: "CNIPA",
      patents: [{ index: 1, pn: "CN111A", title: "已有专利" }]
    }));

    const r = await runCnipaRecipe(
      ["--query", "人工智能", "--delay-ms", "0", "--dedup-file", dedupFile],
      (cmd) => {
        if (cmd.type === "tabs.list") return [];
        if (cmd.type === "page.eval") {
          const s = cmd.params.script;
          if (s.includes("tokenLen")) {
            return { evalResult: { ready: true, url: "http://epub.cnipa.gov.cn/", tokenLen: 120 } };
          }
          if (s.includes("/Dxb/IndexQuery")) {
            return {
              evalResult: {
                ok: true,
                token: "tok-1",
                totalCount: 2,
                totalPages: 1,
                items: [
                  { patent_type: "发明公布", title: "已有专利", pn: "CN111A", an: "202610001" },
                  { patent_type: "发明公布", title: "新增专利", pn: "CN222A", an: "202610002" }
                ]
              }
            };
          }
        }
        return {};
      }
    );

    try {
      assert.equal(r.code, 0, r.out);
      const subdirs = fs.readdirSync(r.outDir);
      const sessionSaved = JSON.parse(fs.readFileSync(path.join(r.outDir, subdirs[0], "专利事实.json"), "utf8"));
      assert.equal(sessionSaved.dedup_new_added, 1);
      assert.equal(sessionSaved.dedup_skipped, 1);
      assert.equal(sessionSaved.patents.length, 1);
      assert.equal(sessionSaved.patents[0].pn, "CN222A");

      const masterSaved = JSON.parse(fs.readFileSync(dedupFile, "utf8"));
      assert.equal(masterSaved.total_patents, 2);
      assert.deepEqual(masterSaved.patents.map((p) => p.pn), ["CN111A", "CN222A"]);
      assert.equal(fs.existsSync(path.join(dedupDir, "master.md")), true);
    } finally {
      fs.rmSync(r.outDir, { recursive: true, force: true });
      fs.rmSync(dedupDir, { recursive: true, force: true });
    }
  });

  test("sw mode queries transaction list and saves results", async () => {
    const r = await runCnipaRecipe(["--mode", "sw", "--an", "2024115380488", "--delay-ms", "0", "--skip-media"], (cmd) => {
      if (cmd.type === "tabs.list") return [];
      if (cmd.type === "page.eval") {
        const s = cmd.params.script;
        if (s.includes("tokenLen")) {
          return { evalResult: { ready: true, url: "http://epub.cnipa.gov.cn/SW", tokenLen: 120 } };
        }
        if (s.includes("/SW/SwListQuery")) {
          return {
            evalResult: {
              ok: true,
              token: "tok-sw",
              totalPages: 1,
              rows: [
                {
                  seq_no: "1",
                  an: "2024115380488",
                  sw_pubdate: "2026.11.17",
                  sw_status: "公布",
                  sw_handle: { anToken: "encAn==", pubType: "3", ggr: "" }
                }
              ]
            }
          };
        }
      }
      return {};
    });

    try {
      assert.equal(r.code, 0, r.out);
      const subdirs = fs.readdirSync(r.outDir);
      assert.equal(subdirs.length, 1);
      const saved = JSON.parse(fs.readFileSync(path.join(r.outDir, subdirs[0], "专利事实.json"), "utf8"));
      assert.equal(saved.mode, "sw");
      assert.equal(saved.patents.length, 1);
      assert.equal(saved.patents[0].an, "2024115380488");
      assert.equal(saved.patents[0].sw_status, "公布");
    } finally {
      fs.rmSync(r.outDir, { recursive: true, force: true });
    }
  });
});
