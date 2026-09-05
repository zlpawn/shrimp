import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function computeSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

export function createKbPipeline({ store, registry, scraper, dataDir }) {
  const rawDir = path.join(dataDir, "raw");
  const filesDir = path.join(dataDir, "files");

  if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
  if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });

  async function executeEngines(inputFilePath, docId, assetsDir) {
    const results = {
      markitdown: { status: "idle", md: "", html: "", duration_ms: 0, error: "" },
      docling: { status: "idle", md: "", html: "", json: "", duration_ms: 0, error: "" },
      assets: [],
    };

    const ext = path.extname(inputFilePath).toLowerCase();
    const mdAdapter = registry.get("markitdown");
    const docAdapter = registry.get("docling");

    // Execute MarkItDown
    if (mdAdapter) {
      try {
        const mdStatus = await mdAdapter.detect();
        if (mdStatus.installed) {
          const res = await mdAdapter.parse(inputFilePath);
          results.markitdown = {
            status: "done",
            md: res.markdown || "",
            html: res.html || "",
            duration_ms: res.durationMs || 0,
            error: "",
          };
          if (res.assets && res.assets.length > 0) {
            results.assets.push(...res.assets);
          }
        } else {
          results.markitdown = {
            status: "skipped",
            md: "",
            html: "",
            duration_ms: 0,
            error: "MarkItDown 未安装，请在系统扩展面板中点击安装",
          };
        }
      } catch (err) {
        results.markitdown = {
          status: "failed",
          md: "",
          html: "",
          duration_ms: 0,
          error: err.message,
        };
      }
    }

    // Execute Docling
    if (docAdapter) {
      try {
        const docStatus = await docAdapter.detect();
        if (docStatus.installed) {
          const res = await docAdapter.parse(inputFilePath, {
            assetsDir,
            outputDir: path.join(filesDir, docId, "docling_out"),
          });
          results.docling = {
            status: "done",
            md: res.markdown || "",
            html: res.html || "",
            json: res.jsonStructure ? JSON.stringify(res.jsonStructure) : "",
            duration_ms: res.durationMs || 0,
            error: "",
          };
          if (res.assets && res.assets.length > 0) {
            results.assets.push(...res.assets);
          }
        } else {
          results.docling = {
            status: "skipped",
            md: "",
            html: "",
            json: "",
            duration_ms: 0,
            error: "Docling 未安装，请在系统扩展面板中点击安装",
          };
        }
      } catch (err) {
        results.docling = {
          status: "failed",
          md: "",
          html: "",
          json: "",
          duration_ms: 0,
          error: err.message,
        };
      }
    }

    return results;
  }

  async function ingestFile({ filePath, originalFilename, collectionId = "col_default" }) {
    const ext = path.extname(originalFilename || filePath).toLowerCase();
    const hash = computeSha256(filePath);
    const rawDestPath = path.join(rawDir, `${hash}${ext}`);
    if (!fs.existsSync(rawDestPath)) {
      fs.copyFileSync(filePath, rawDestPath);
    }

    const stat = fs.statSync(rawDestPath);
    const now = Date.now();
    const docId = `doc_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const assetsDir = path.join(filesDir, docId, "assets");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    // Create initial doc record
    store.createDocument({
      id: docId,
      collection_id: collectionId,
      title: originalFilename || path.basename(filePath),
      source_type: "file",
      file_name: originalFilename || path.basename(filePath),
      file_path: rawDestPath,
      file_size: stat.size,
      file_hash: hash,
      markitdown_status: "running",
      docling_status: "running",
    });

    const results = await executeEngines(rawDestPath, docId, assetsDir);
    const wordCount = Math.max(
      (results.docling.md || "").replace(/\s+/g, "").length,
      (results.markitdown.md || "").replace(/\s+/g, "").length
    );

    const updated = store.updateDocumentResult(docId, {
      markitdown_status: results.markitdown.status,
      markitdown_md: results.markitdown.md,
      markitdown_html: results.markitdown.html,
      markitdown_duration_ms: results.markitdown.duration_ms,
      markitdown_error: results.markitdown.error,
      docling_status: results.docling.status,
      docling_md: results.docling.md,
      docling_html: results.docling.html,
      docling_json: results.docling.json,
      docling_duration_ms: results.docling.duration_ms,
      docling_error: results.docling.error,
      assets: results.assets,
      word_count: wordCount,
    });

    return updated;
  }

  async function ingestUrl({ url, collectionId = "col_default", useLeo = false }) {
    const now = Date.now();
    const docId = `doc_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const assetsDir = path.join(filesDir, docId, "assets");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const scraped = await scraper.scrape(url, { docId, assetsDir, useLeo });
    const rawDestPath = path.join(rawDir, `${docId}.html`);
    fs.writeFileSync(rawDestPath, scraped.html, "utf8");
    const stat = fs.statSync(rawDestPath);

    store.createDocument({
      id: docId,
      collection_id: collectionId,
      title: scraped.title || url,
      source_type: "url",
      source_url: url,
      file_name: `${scraped.title || "webpage"}.html`,
      file_path: rawDestPath,
      file_size: stat.size,
      file_hash: crypto.createHash("sha256").update(scraped.html).digest("hex"),
      markitdown_status: "running",
      docling_status: "running",
      assets: scraped.assets || [],
    });

    const results = await executeEngines(rawDestPath, docId, assetsDir);
    const mergedAssets = [...(scraped.assets || [])];
    for (const a of results.assets) {
      if (!mergedAssets.some((existing) => existing.name === a.name)) {
        mergedAssets.push(a);
      }
    }

    const wordCount = Math.max(
      (results.docling.md || "").replace(/\s+/g, "").length,
      (results.markitdown.md || "").replace(/\s+/g, "").length
    );

    const updated = store.updateDocumentResult(docId, {
      markitdown_status: results.markitdown.status,
      markitdown_md: results.markitdown.md,
      markitdown_html: results.markitdown.html,
      markitdown_duration_ms: results.markitdown.duration_ms,
      markitdown_error: results.markitdown.error,
      docling_status: results.docling.status,
      docling_md: results.docling.md,
      docling_html: results.docling.html,
      docling_json: results.docling.json,
      docling_duration_ms: results.docling.duration_ms,
      docling_error: results.docling.error,
      assets: mergedAssets,
      word_count: wordCount,
    });

    return updated;
  }

  async function ingestText({ text, title = "纯文本草稿", collectionId = "col_default" }) {
    const now = Date.now();
    const docId = `doc_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const assetsDir = path.join(filesDir, docId, "assets");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const rawDestPath = path.join(rawDir, `${docId}.md`);
    fs.writeFileSync(rawDestPath, text, "utf8");
    const stat = fs.statSync(rawDestPath);

    store.createDocument({
      id: docId,
      collection_id: collectionId,
      title: title || "纯文本草稿",
      source_type: "text",
      file_name: `${title}.md`,
      file_path: rawDestPath,
      file_size: stat.size,
      file_hash: crypto.createHash("sha256").update(text).digest("hex"),
      markitdown_status: "running",
      docling_status: "running",
    });

    const results = await executeEngines(rawDestPath, docId, assetsDir);
    const wordCount = Math.max(
      (results.docling.md || text).replace(/\s+/g, "").length,
      (results.markitdown.md || text).replace(/\s+/g, "").length
    );

    const updated = store.updateDocumentResult(docId, {
      markitdown_status: results.markitdown.status,
      markitdown_md: results.markitdown.md || text,
      markitdown_html: results.markitdown.html,
      markitdown_duration_ms: results.markitdown.duration_ms,
      markitdown_error: results.markitdown.error,
      docling_status: results.docling.status,
      docling_md: results.docling.md || text,
      docling_html: results.docling.html,
      docling_json: results.docling.json,
      docling_duration_ms: results.docling.duration_ms,
      docling_error: results.docling.error,
      assets: results.assets,
      word_count: wordCount,
    });

    return updated;
  }

  return {
    ingestFile,
    ingestUrl,
    ingestText,
  };
}
