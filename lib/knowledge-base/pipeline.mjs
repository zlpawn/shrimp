import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { transcribeImageWithVisionLLM, buildCompleteMarkdownDocument } from "./vision-transcriber.mjs";
import { downloadImageFromUrl } from "./gallery-dl.mjs";

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

    const docDir = path.join(filesDir, docId);
    if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
    if (results.markitdown.md) {
      fs.writeFileSync(path.join(docDir, "markitdown.md"), results.markitdown.md, "utf8");
    }
    if (results.docling.md) {
      fs.writeFileSync(path.join(docDir, "docling.md"), results.docling.md, "utf8");
    }

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

    const docDir = path.join(filesDir, docId);
    if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
    if (results.markitdown.md) {
      fs.writeFileSync(path.join(docDir, "markitdown.md"), results.markitdown.md, "utf8");
    }
    if (results.docling.md) {
      fs.writeFileSync(path.join(docDir, "docling.md"), results.docling.md, "utf8");
    }

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

  async function ingestText({ text, title = "纯文本草稿", collectionId = "col_default", sourceType = "text", sourceUrl = "" }) {
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
      title: title || (sourceType === "video" ? "视频转录文档" : "纯文本草稿"),
      source_type: sourceType || "text",
      source_url: sourceUrl || "",
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

    const docDir = path.join(filesDir, docId);
    if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, "final.md"), text, "utf8");
    fs.writeFileSync(path.join(docDir, "markitdown.md"), results.markitdown.md || text, "utf8");
    fs.writeFileSync(path.join(docDir, "docling.md"), results.docling.md || text, "utf8");

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
      final_content: text,
      doc_type: sourceType === "video" ? "video" : "document",
      adopted_engine: sourceType === "video" ? "whisper" : "custom",
      accepted_at: now,
    });

    return updated;
  }

  async function ingestCraftNote({ rootBlockId, title, markdown, collectionId = "col_default", craftUrl = "" }) {
    const now = Date.now();
    const docId = `doc_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const assetsDir = path.join(filesDir, docId, "assets");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const safeTitle = (title || "未命名 Craft 笔记").replace(/[\\/:*?"<>|]/g, "_");
    const rawDestPath = path.join(rawDir, `${docId}.md`);
    fs.writeFileSync(rawDestPath, markdown, "utf8");
    const stat = fs.statSync(rawDestPath);

    store.createDocument({
      id: docId,
      collection_id: collectionId,
      title: title || "未命名 Craft 笔记",
      source_type: "craft",
      doc_type: "document",
      source_url: craftUrl || `craftdocs://open?blockId=${rootBlockId}`,
      file_name: `${safeTitle}.md`,
      file_path: rawDestPath,
      file_size: stat.size,
      file_hash: crypto.createHash("sha256").update(markdown).digest("hex"),
      markitdown_status: "running",
      docling_status: "running",
    });

    const results = await executeEngines(rawDestPath, docId, assetsDir);
    const wordCount = Math.max(
      (results.docling.md || markdown).replace(/\s+/g, "").length,
      (results.markitdown.md || markdown).replace(/\s+/g, "").length
    );

    const docDir = path.join(filesDir, docId);
    if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, "final.md"), markdown, "utf8");
    fs.writeFileSync(path.join(docDir, "markitdown.md"), results.markitdown.md || markdown, "utf8");
    fs.writeFileSync(path.join(docDir, "docling.md"), results.docling.md || markdown, "utf8");

    const updated = store.updateDocumentResult(docId, {
      markitdown_status: results.markitdown.status,
      markitdown_md: results.markitdown.md || markdown,
      markitdown_html: results.markitdown.html,
      markitdown_duration_ms: results.markitdown.duration_ms,
      markitdown_error: results.markitdown.error,
      docling_status: results.docling.status,
      docling_md: results.docling.md || markdown,
      docling_html: results.docling.html,
      docling_json: results.docling.json,
      docling_duration_ms: results.docling.duration_ms,
      docling_error: results.docling.error,
      assets: results.assets,
      word_count: wordCount,
      final_content: markdown,
      doc_type: "document",
      adopted_engine: "craft",
      accepted_at: now,
    });

    return updated;
  }

  async function ingestWereadBookNotes({
    bookId,
    title,
    author,
    cover,
    readingProgress,
    category,
    collectionId = "col_default",
    markdown,
    deepLink = "",
  }) {
    const now = Date.now();
    const safeTitle = (title || "微信读书笔记").replace(/[\\/:*?"<>|]/g, "_");
    const targetUrl = deepLink || `https://weread.qq.com/web/reader/${bookId}`;

    const existingDocs = store.listDocuments({ collection_id: collectionId });
    const existing = existingDocs.find(
      (d) => d.source_type === "weread" && (d.source_url === targetUrl || d.source_url.includes(bookId))
    );

    const docId = existing ? existing.id : `doc_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const assetsDir = path.join(filesDir, docId, "assets");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const rawDestPath = path.join(rawDir, `${docId}.md`);
    fs.writeFileSync(rawDestPath, markdown, "utf8");
    const stat = fs.statSync(rawDestPath);

    if (!existing) {
      store.createDocument({
        id: docId,
        collection_id: collectionId,
        title: title || "微信读书笔记",
        source_type: "weread",
        doc_type: "document",
        source_url: targetUrl,
        file_name: `${safeTitle}.md`,
        file_path: rawDestPath,
        file_size: stat.size,
        file_hash: crypto.createHash("sha256").update(markdown).digest("hex"),
        markitdown_status: "succeeded",
        docling_status: "succeeded",
      });
    }

    const docDir = path.join(filesDir, docId);
    if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, "final.md"), markdown, "utf8");

    const wordCount = markdown.replace(/\s+/g, "").length;

    const updated = store.updateDocumentResult(docId, {
      title: title || "微信读书笔记",
      markitdown_status: "succeeded",
      markitdown_md: markdown,
      docling_status: "succeeded",
      docling_md: markdown,
      word_count: wordCount,
      final_content: markdown,
      doc_type: "document",
      adopted_engine: "weread",
      accepted_at: now,
    });

    return updated;
  }

  function adoptDocument(docId, { engine = "custom", content = null } = {}) {
    const adopted = store.adoptDocument(docId, { engine, content });
    if (!adopted) return null;
    const docDir = path.join(filesDir, docId);
    if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, "final.md"), adopted.final_content || "", "utf8");
    return adopted;
  }

  async function ingestImage({
    imageBuffer,
    originalFilename = "image.png",
    title = "",
    collectionId = "col_default",
    client = "code",
    endpointId = "",
    model = "qwen-vl-max",
    listenPort = 8788,
    sourceUrl = "",
  }) {
    const ext = path.extname(originalFilename || "image.png").toLowerCase() || ".png";
    const hash = crypto.createHash("sha256").update(imageBuffer).digest("hex");
    const now = Date.now();
    const docId = `doc_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const docDir = path.join(filesDir, docId);
    const assetsDir = path.join(docDir, "assets");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const rawDestPath = path.join(rawDir, `${hash}${ext}`);
    if (!fs.existsSync(rawDestPath)) {
      fs.writeFileSync(rawDestPath, imageBuffer);
    }
    const docRawPath = path.join(docDir, `raw${ext}`);
    fs.writeFileSync(docRawPath, imageBuffer);

    const stat = fs.statSync(rawDestPath);
    const displayTitle = title || originalFilename || "未命名图像";

    store.createDocument({
      id: docId,
      collection_id: collectionId,
      title: displayTitle,
      source_type: "image",
      source_url: sourceUrl || null,
      doc_type: "image",
      file_name: originalFilename,
      file_path: docRawPath,
      file_size: stat.size,
      file_hash: hash,
      markitdown_status: "running",
      docling_status: "running",
    });

    let completeMd = "";
    let mermaidCode = "";
    let tableMarkdown = "";
    let rawContent = "";
    let bulletPoints = [];
    const assetItem = {
      name: originalFilename,
      url: `/v1/kb/assets/${docId}/${originalFilename}`,
      path: docRawPath,
    };

    try {
      const visionResult = await transcribeImageWithVisionLLM({
        imagePath: docRawPath,
        assetUrl: assetItem.url,
        filename: originalFilename,
        title: displayTitle,
        sourceType: "doc",
        client,
        endpointId,
        model,
        listenPort,
      });

      mermaidCode = visionResult.mermaidCode || "";
      tableMarkdown = visionResult.tableMarkdown || "";
      rawContent = visionResult.rawContent || "";
      bulletPoints = visionResult.bulletPoints || [];

      completeMd = buildCompleteMarkdownDocument({
        title: displayTitle,
        assetUrl: assetItem.url,
        filename: originalFilename,
        mermaidCode,
        tableMarkdown,
        rawContent,
        bulletPoints,
        model,
      });
    } catch (err) {
      console.warn(`[Pipeline] Vision transcription failed for ${docId}:`, err);
      completeMd = `# ${displayTitle}\n\n> 📸 原始凭证: [${originalFilename}](${assetItem.url})\n\n⚠️ 视觉模型转译失败: ${err.message}\n`;
    }

    fs.writeFileSync(path.join(docDir, "final.md"), completeMd, "utf8");
    fs.writeFileSync(path.join(docDir, "docling.md"), completeMd, "utf8");
    fs.writeFileSync(path.join(docDir, "markitdown.md"), completeMd, "utf8");

    const wordCount = completeMd.replace(/\s+/g, "").length;
    const updated = store.updateDocumentResult(docId, {
      markitdown_status: "done",
      markitdown_md: completeMd,
      markitdown_duration_ms: 0,
      docling_status: "done",
      docling_md: completeMd,
      docling_duration_ms: 0,
      final_content: completeMd,
      doc_type: "image",
      adopted_engine: "vision",
      accepted_at: now,
      assets: [assetItem],
      word_count: wordCount,
    });

    return updated;
  }

  async function ingestImageUrl({
    url,
    title = "",
    collectionId = "col_default",
    client = "code",
    endpointId = "",
    model = "qwen-vl-max",
    listenPort = 8788,
  }) {
    const tempDir = path.join(filesDir, "temp_downloads", `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const downloadRes = await downloadImageFromUrl(url, tempDir);
    try {
      const displayTitle = title || downloadRes.fileName.replace(/\.[^/.]+$/, "") || "网页图像";
      const doc = await ingestImage({
        imageBuffer: downloadRes.buffer,
        originalFilename: downloadRes.fileName,
        title: displayTitle,
        collectionId,
        client,
        endpointId,
        model,
        listenPort,
        sourceUrl: url,
      });

      return doc;
    } finally {
      // Clean up temp dir
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  function generateAgentPrompt({ docIds = [], collectionId = null }) {
    let docs = [];
    let col = null;
    if (collectionId) {
      col = store.getCollection(collectionId);
    }
    if (docIds && docIds.length > 0) {
      docs = docIds.map((id) => store.getDocument(id)).filter(Boolean);
    } else if (collectionId) {
      docs = store.listDocuments({ collection_id: collectionId, limit: 200 });
    }
    if (docs.length === 0) {
      return { promptText: "未选择任何文档素材", items: [] };
    }

    const colName = col?.name || "知识库";
    const colDir = path.resolve(filesDir);
    const colUri = `file:///${colDir.replace(/\\/g, "/")}`;

    const lines = [];
    lines.push("请基于以下已解析与校验的知识库素材进行分析与知识沉淀：\n");
    lines.push(`📁 知识库目录: [${colName}](${colUri})`);
    lines.push(`- 目录物理路径: \`${colDir}\`\n`);
    lines.push(`📄 包含素材列表 (共 ${docs.length} 项):`);

    const items = [];
    docs.forEach((d, idx) => {
      const docDir = path.resolve(filesDir, d.id);
      const finalFile = path.resolve(docDir, "final.md");
      const rawFile = d.file_path ? path.resolve(d.file_path) : "";
      const mdFile = path.resolve(docDir, "markitdown.md");
      const dlFile = path.resolve(docDir, "docling.md");

      const finalUri = `file:///${finalFile.replace(/\\/g, "/")}`;
      const rawUri = rawFile ? `file:///${rawFile.replace(/\\/g, "/")}` : "";
      const mdUri = `file:///${mdFile.replace(/\\/g, "/")}`;
      const dlUri = `file:///${dlFile.replace(/\\/g, "/")}`;

      const typeLabel = d.doc_type === "video" || d.source_type === "video" ? "视频类" : d.doc_type === "image" || d.source_type === "image" ? "图像类" : "文档类";

      lines.push(`${idx + 1}. **《${d.title}》** (${typeLabel})`);
      lines.push(`   - 最终采纳正文: [final.md](${finalUri})`);
      lines.push(`     - 物理路径: \`${finalFile}\``);
      if (rawFile && fs.existsSync(rawFile)) {
        lines.push(`   - 原始文件参考: [${path.basename(rawFile)}](${rawUri})`);
        lines.push(`     - 物理路径: \`${rawFile}\``);
      }
      if (d.doc_type !== "image" && d.source_type !== "video") {
        lines.push(`   - 引擎候选版本: [Docling版](${dlUri}) | [MarkItDown版](${mdUri})`);
      }
      lines.push("");

      items.push({
        id: d.id,
        title: d.title,
        doc_type: d.doc_type,
        finalPath: finalFile,
        rawPath: rawFile,
        finalUri,
        rawUri,
      });
    });

    lines.push("💡 执行建议：");
    lines.push("- 请使用你的文件读取工具（如 view_file 或 readFile）优先读取各素材的 `final.md` 正文；");
    lines.push("- 如需核验原始细节或图表，可查阅对应的原始文件物理路径；");
    lines.push("- 请结合当前工作区或目标知识库，执行概念整理、双链构建、代码重构或文档撰写。");

    return {
      promptText: lines.join("\n"),
      items,
    };
  }

  return {
    ingestFile,
    ingestUrl,
    ingestText,
    ingestCraftNote,
    ingestWereadBookNotes,
    ingestImage,
    ingestImageUrl,
    adoptDocument,
    generateAgentPrompt,
  };
}

