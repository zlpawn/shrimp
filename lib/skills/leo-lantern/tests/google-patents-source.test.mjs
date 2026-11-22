import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  stripHtml,
  normalizePn,
  parsePatentUrl,
  normalizeGpDate,
  pickPageSize,
  buildInnerQuery,
  buildQueryUrl,
  mapSearchResult,
  deduplicateAndMerge,
  parseCliArgs,
  generateMarkdown
} from "../recipes/google-patents-source.mjs";
import { startFakeExtension } from "./fake-extension.mjs";

const RECIPE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../recipes/google-patents-source.mjs");

async function runGpRecipe(args, handler) {
  const fake = await startFakeExtension(handler);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-gp-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-gp-home-"));
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

describe("google-patents-source pure helpers", () => {
  test("stripHtml removes highlight tags and decodes entities", () => {
    assert.equal(stripHtml("A <b>neural</b> &amp; network &hellip;"), "A neural & network …");
  });

  test("normalizePn and parsePatentUrl normalize publication numbers", () => {
    assert.equal(normalizePn("us 12,482,160 b2"), "US12482160B2");
    assert.deepEqual(parsePatentUrl("https://patents.google.com/patent/US12482160B2/en"), {
      pn: "US12482160B2",
      lang: "en"
    });
    assert.deepEqual(parsePatentUrl("https://patents.google.com/patent/CN113254803B"), {
      pn: "CN113254803B",
      lang: "en"
    });
    assert.equal(parsePatentUrl("https://patents.google.com/?q=ai"), null);
  });

  test("normalizeGpDate formats dates as YYYYMMDD and rejects invalid dates", () => {
    assert.equal(normalizeGpDate("2025-11-25"), "20251125");
    assert.equal(normalizeGpDate("2025.11.25"), "20251125");
    assert.equal(normalizeGpDate("20251125"), "20251125");
    assert.throws(() => normalizeGpDate("2025-1-2"), /日期格式无效/);
  });

  test("buildInnerQuery and buildQueryUrl encode filters and pagination", () => {
    assert.equal(pickPageSize(5), 10);
    assert.equal(pickPageSize(15), 20);
    assert.equal(pickPageSize(200), 100);

    const opts = parseCliArgs([
      "--query", "neural network",
      "--assignee", "Google LLC",
      "--cpc", "G06N3/08",
      "--country", "us,cn",
      "--after", "2022-01-01",
      "--status", "grant",
      "--type", "patent",
      "--sort", "new",
      "--limit", "15"
    ]);
    const inner = buildInnerQuery(opts, 2);
    assert.match(inner, /q=\(neural\+network\)/);
    assert.match(inner, /q=\(CPC%3DG06N3%2F08\)/);
    assert.match(inner, /assignee=Google\+LLC/);
    assert.match(inner, /country=US,CN/);
    assert.match(inner, /after=priority:20220101/);
    assert.match(inner, /status=GRANT/);
    assert.match(inner, /type=PATENT/);
    assert.match(inner, /sort=new/);
    assert.match(inner, /num=20&page=2$/);
    assert.match(buildQueryUrl(opts, 0), /^\/xhr\/query\?url=.*&exp=$/);
  });

  test("mapSearchResult normalizes /xhr/query items", () => {
    const mapped = mapSearchResult({
      id: "patent/US12482160B2/en",
      patent: {
        publication_number: "US12482160B2",
        title: "Generating images using <b>neural networks</b>",
        snippet: "one or more <b>neural</b> &hellip;",
        assignee: "<b>Google</b> Llc",
        inventor: "Chitwan Saharia",
        priority_date: "2022-05-19",
        filing_date: "2024-04-02",
        publication_date: "2025-11-25",
        grant_date: "2025-11-25",
        pdf: "ab/cd/US12482160.pdf",
        thumbnail: "60x80/US12482160B2/D0.png",
        figures: [{ full: "US12482160B2/D0.png" }],
        family_metadata: {
          aggregated: {
            country_status: [{ country_code: "US", best_patent_stage: { state: "ACTIVE" } }]
          }
        }
      }
    });
    assert.equal(mapped.publication_number, "US12482160B2");
    assert.equal(mapped.title, "Generating images using neural networks");
    assert.equal(mapped.assignee, "Google Llc");
    assert.equal(mapped.pdf_url, "https://patentimages.storage.googleapis.com/ab/cd/US12482160.pdf");
    assert.deepEqual(mapped.figures, ["https://patentimages.storage.googleapis.com/US12482160B2/D0.png"]);
    assert.deepEqual(mapped.family_country_status, [{ country: "US", state: "ACTIVE" }]);
  });

  test("parseCliArgs infers modes and validates required flags", () => {
    const d1 = parseCliArgs(["https://patents.google.com/patent/CN113254803B/zh"]);
    assert.equal(d1.mode, "detail");
    assert.deepEqual(d1.pns, ["CN113254803B"]);
    assert.equal(d1.lang, "zh");
    assert.equal(d1.downloadFigures, true);
    assert.equal(d1.downloadPdf, true);

    const d2 = parseCliArgs(["US12482160B2", "--skip-media"]);
    assert.equal(d2.mode, "detail");
    assert.equal(d2.downloadFigures, false);
    assert.equal(d2.downloadPdf, false);

    const s1 = parseCliArgs(["--url", "https://patents.google.com/?q=(battery)&country=CN"]);
    assert.equal(s1.mode, "search");
    assert.equal(s1.rawQuery, "q=(battery)&country=CN");
    assert.equal(s1.downloadFigures, false);

    assert.throws(() => parseCliArgs([]), /search 模式需要至少一个检索条件/);
    assert.throws(() => parseCliArgs(["--mode", "detail"]), /detail 模式需要/);
    assert.throws(() => parseCliArgs(["--query", "ai", "--status", "bad"]), /--status 无效/);
  });

  test("deduplicateAndMerge and generateMarkdown produce clean output", () => {
    const merged = deduplicateAndMerge(
      [
        { publication_number: "US12482160B2", title: "dup" },
        { publication_number: "CN113254803B", title: "new", url: "https://patents.google.com/patent/CN113254803B/en" }
      ],
      [{ index: 1, publication_number: "us12482160b2", title: "old", url: "https://patents.google.com/patent/US12482160B2/en" }]
    );
    assert.equal(merged.added.length, 1);
    assert.equal(merged.skippedDuplicates, 1);
    assert.equal(merged.merged.length, 2);

    const md = generateMarkdown({
      mode: "search",
      target: "neural network",
      total_results: 100,
      total_media_files: 0,
      fetched_at: "2026-11-21T00:00:00.000Z",
      patents: merged.merged
    });
    assert.match(md, /Google Patents 专利事实档案/);
    assert.match(md, /US12482160B2/);
    assert.match(md, /CN113254803B/);
  });
});

describe("google-patents-source end-to-end with fake extension", () => {
  test("search mode fetches /xhr/query, enriches details, writes files, and closes task", async () => {
    const r = await runGpRecipe(
      ["--query", "neural network", "--limit", "1", "--skip-media", "--delay-ms", "0"],
      (cmd) => {
        if (cmd.type === "page.eval") {
          const s = cmd.params.script;
          if (s.includes("location.hostname")) return { evalResult: { host: "patents.google.com", ready: "complete" } };
          if (s.includes("window.__leoGp[id] = { done: false }")) return { evalResult: "job_1" };
          if (s.includes("delete window.__leoGp")) {
            return {
              evalResult: {
                done: true,
                ok: true,
                result: {
                  ok: true,
                  status: 200,
                  total: 1,
                  totalPages: 1,
                  items: [
                    {
                      id: "patent/US12482160B2/en",
                      patent: {
                        publication_number: "US12482160B2",
                        title: "Generating images using <b>neural networks</b>",
                        assignee: "Google LLC",
                        priority_date: "2022-05-19",
                        publication_date: "2025-11-25"
                      }
                    }
                  ],
                  detail: {
                    title: "Generating images using neural networks",
                    publication_number: "US12482160B2",
                    application_number: "US18/624,960",
                    legal_status: "Active",
                    abstract: "A method for generating images.",
                    claims_count: 1,
                    claims: ["1. A computer-implemented method."],
                    description: "Detailed description text.",
                    classifications: [{ code: "G06T11/00", description: "2D image generation" }]
                  }
                }
              }
            };
          }
        }
        return {};
      }
    );

    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /🎉 Google Patents 抓取完成/);
    assert.equal(r.commands.some((c) => c.type === "task.end"), true);

    const sessions = fs.readdirSync(r.outDir);
    assert.equal(sessions.length, 1);
    const sessionDir = path.join(r.outDir, sessions[0]);
    const payload = JSON.parse(fs.readFileSync(path.join(sessionDir, "专利事实.json"), "utf8"));
    assert.equal(payload.total_count, 1);
    assert.equal(payload.patents[0].publication_number, "US12482160B2");
    assert.equal(payload.patents[0].application_number, "US18/624,960");
    assert.equal(fs.existsSync(path.join(sessionDir, "patents", "US12482160B2", "claims.md")), true);
    assert.equal(fs.existsSync(path.join(sessionDir, "patents", "US12482160B2", "description.md")), true);
  });
});
