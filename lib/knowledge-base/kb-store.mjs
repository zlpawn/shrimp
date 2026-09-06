import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function createKbStore({ dbPath }) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  function init() {
    db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS kb_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        icon TEXT DEFAULT 'folder',
        color TEXT DEFAULT '#3b82f6',
        doc_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        file_path TEXT DEFAULT '',
        file_size INTEGER DEFAULT 0,
        file_hash TEXT DEFAULT '',
        
        markitdown_status TEXT DEFAULT 'idle',
        markitdown_md TEXT DEFAULT '',
        markitdown_html TEXT DEFAULT '',
        markitdown_duration_ms INTEGER DEFAULT 0,
        markitdown_error TEXT DEFAULT '',

        docling_status TEXT DEFAULT 'idle',
        docling_md TEXT DEFAULT '',
        docling_html TEXT DEFAULT '',
        docling_json TEXT DEFAULT '',
        docling_duration_ms INTEGER DEFAULT 0,
        docling_error TEXT DEFAULT '',

        assets_json TEXT DEFAULT '[]',
        word_count INTEGER DEFAULT 0,
        adopted_engine TEXT DEFAULT 'both',
        final_content TEXT DEFAULT '',
        doc_type TEXT DEFAULT 'document',
        accepted_at INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS kb_documents_fts USING fts5(
        doc_id UNINDEXED,
        title,
        content
      );
    `);

    // Migrations for new columns
    try { db.exec("ALTER TABLE kb_documents ADD COLUMN final_content TEXT DEFAULT ''"); } catch {}
    try { db.exec("ALTER TABLE kb_documents ADD COLUMN doc_type TEXT DEFAULT 'document'"); } catch {}
    try { db.exec("ALTER TABLE kb_documents ADD COLUMN accepted_at INTEGER DEFAULT 0"); } catch {}

    // Migrate legacy 'folder' icon to '📁'
    try {
      db.prepare("UPDATE kb_collections SET icon = '📁' WHERE icon = 'folder'").run();
    } catch {
      // ignore
    }

    // Ensure default collection exists
    const defaultCol = getCollection("col_default");
    if (!defaultCol) {
      createCollection({
        id: "col_default",
        name: "默认知识库",
        description: "未分类文档的默认归宿",
        icon: "📁",
        color: "#3b82f6",
      });
    }
  }

  function createCollection(col) {
    const now = Date.now();
    const item = {
      id: col.id || `col_${now}_${Math.random().toString(36).slice(2, 7)}`,
      name: col.name || "新建知识库",
      description: col.description || "",
      icon: (col.icon && col.icon !== "folder") ? col.icon : "📁",
      color: col.color || "#3b82f6",
      doc_count: col.doc_count || 0,
      created_at: col.created_at || now,
      updated_at: col.updated_at || now,
    };
    db.prepare(`
      INSERT OR REPLACE INTO kb_collections (id, name, description, icon, color, doc_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.name,
      item.description,
      item.icon,
      item.color,
      item.doc_count,
      item.created_at,
      item.updated_at
    );
    return item;
  }

  function listCollections() {
    return db.prepare("SELECT * FROM kb_collections ORDER BY created_at ASC").all();
  }

  function getCollection(id) {
    return db.prepare("SELECT * FROM kb_collections WHERE id = ?").get(id) || null;
  }

  function updateCollection(id, updates = {}) {
    const existing = getCollection(id);
    if (!existing) return null;
    const now = Date.now();
    const updated = {
      ...existing,
      ...updates,
      updated_at: now,
    };
    db.prepare(`
      UPDATE kb_collections
      SET name = ?, description = ?, icon = ?, color = ?, doc_count = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.description,
      updated.icon,
      updated.color,
      updated.doc_count,
      updated.updated_at,
      id
    );
    return updated;
  }

  function deleteCollection(id) {
    const docs = db.prepare("SELECT id FROM kb_documents WHERE collection_id = ?").all(id);
    for (const d of docs) {
      db.prepare("DELETE FROM kb_documents_fts WHERE doc_id = ?").run(d.id);
    }
    db.prepare("DELETE FROM kb_documents WHERE collection_id = ?").run(id);
    db.prepare("DELETE FROM kb_collections WHERE id = ?").run(id);
    return true;
  }

  function createDocument(doc) {
    const now = Date.now();
    const item = {
      id: doc.id || `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
      collection_id: doc.collection_id || "col_default",
      title: doc.title || "未命名文档",
      source_type: doc.source_type || "file",
      source_url: doc.source_url || "",
      file_name: doc.file_name || "",
      file_path: doc.file_path || "",
      file_size: doc.file_size || 0,
      file_hash: doc.file_hash || "",
      markitdown_status: doc.markitdown_status || "idle",
      markitdown_md: doc.markitdown_md || "",
      markitdown_html: doc.markitdown_html || "",
      markitdown_duration_ms: doc.markitdown_duration_ms || 0,
      markitdown_error: doc.markitdown_error || "",
      docling_status: doc.docling_status || "idle",
      docling_md: doc.docling_md || "",
      docling_html: doc.docling_html || "",
      docling_json: doc.docling_json || "",
      docling_duration_ms: doc.docling_duration_ms || 0,
      docling_error: doc.docling_error || "",
      assets_json: typeof doc.assets_json === "string" ? doc.assets_json : JSON.stringify(doc.assets || []),
      word_count: doc.word_count || 0,
      adopted_engine: doc.adopted_engine || "both",
      final_content: doc.final_content || "",
      doc_type: doc.doc_type || (doc.source_type === "video" ? "video" : doc.source_type === "image" ? "image" : (
        [".mp4", ".mp3", ".wav", ".m4a", ".mov", ".mkv", ".flv", ".webm", ".aac"].includes(path.extname(doc.file_name || doc.file_path || "").toLowerCase())
          ? "video"
          : [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(path.extname(doc.file_name || doc.file_path || "").toLowerCase())
          ? "image"
          : "document"
      )),
      accepted_at: doc.accepted_at || 0,
      created_at: doc.created_at || now,
      updated_at: doc.updated_at || now,
    };

    db.prepare(`
      INSERT INTO kb_documents (
        id, collection_id, title, source_type, source_url, file_name, file_path, file_size, file_hash,
        markitdown_status, markitdown_md, markitdown_html, markitdown_duration_ms, markitdown_error,
        docling_status, docling_md, docling_html, docling_json, docling_duration_ms, docling_error,
        assets_json, word_count, adopted_engine, final_content, doc_type, accepted_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      item.id, item.collection_id, item.title, item.source_type, item.source_url, item.file_name, item.file_path, item.file_size, item.file_hash,
      item.markitdown_status, item.markitdown_md, item.markitdown_html, item.markitdown_duration_ms, item.markitdown_error,
      item.docling_status, item.docling_md, item.docling_html, item.docling_json, item.docling_duration_ms, item.docling_error,
      item.assets_json, item.word_count, item.adopted_engine, item.final_content, item.doc_type, item.accepted_at, item.created_at, item.updated_at
    );

    // Sync FTS5
    db.prepare("INSERT INTO kb_documents_fts (doc_id, title, content) VALUES (?, ?, ?)").run(
      item.id,
      item.title,
      `${item.final_content || ""} ${item.markitdown_md} ${item.docling_md}`
    );

    // Update collection document count
    db.prepare("UPDATE kb_collections SET doc_count = doc_count + 1 WHERE id = ?").run(item.collection_id);

    return item;
  }

  function getDocument(id) {
    const row = db.prepare("SELECT * FROM kb_documents WHERE id = ?").get(id);
    if (!row) return null;
    return {
      ...row,
      assets: JSON.parse(row.assets_json || "[]"),
    };
  }

  function listDocuments({ collection_id = null, doc_type = null, limit = 50, offset = 0 } = {}) {
    let query = "SELECT * FROM kb_documents WHERE 1=1";
    const params = [];
    if (collection_id) {
      query += " AND collection_id = ?";
      params.push(collection_id);
    }
    if (doc_type) {
      query += " AND doc_type = ?";
      params.push(doc_type);
    }
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    const rows = db.prepare(query).all(...params);
    return rows.map((r) => ({
      ...r,
      assets: JSON.parse(r.assets_json || "[]"),
    }));
  }

  function updateDocumentResult(id, updates = {}) {
    const existing = getDocument(id);
    if (!existing) return null;
    const now = Date.now();
    const updated = {
      ...existing,
      ...updates,
      assets_json: updates.assets ? JSON.stringify(updates.assets) : (updates.assets_json || existing.assets_json),
      final_content: updates.final_content !== undefined ? updates.final_content : (existing.final_content || ""),
      doc_type: updates.doc_type !== undefined ? updates.doc_type : (existing.doc_type || "document"),
      accepted_at: updates.accepted_at !== undefined ? updates.accepted_at : (existing.accepted_at || 0),
      updated_at: now,
    };

    db.prepare(`
      UPDATE kb_documents SET
        title = ?,
        markitdown_status = ?,
        markitdown_md = ?,
        markitdown_html = ?,
        markitdown_duration_ms = ?,
        markitdown_error = ?,
        docling_status = ?,
        docling_md = ?,
        docling_html = ?,
        docling_json = ?,
        docling_duration_ms = ?,
        docling_error = ?,
        assets_json = ?,
        word_count = ?,
        adopted_engine = ?,
        final_content = ?,
        doc_type = ?,
        accepted_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updated.title,
      updated.markitdown_status,
      updated.markitdown_md,
      updated.markitdown_html,
      updated.markitdown_duration_ms,
      updated.markitdown_error,
      updated.docling_status,
      updated.docling_md,
      updated.docling_html,
      updated.docling_json,
      updated.docling_duration_ms,
      updated.docling_error,
      updated.assets_json,
      updated.word_count,
      updated.adopted_engine,
      updated.final_content,
      updated.doc_type,
      updated.accepted_at,
      updated.updated_at,
      id
    );

    // Update FTS
    db.prepare("DELETE FROM kb_documents_fts WHERE doc_id = ?").run(id);
    db.prepare("INSERT INTO kb_documents_fts (doc_id, title, content) VALUES (?, ?, ?)").run(
      id,
      updated.title,
      `${updated.final_content || ""} ${updated.markitdown_md} ${updated.docling_md}`
    );

    return getDocument(id);
  }

  function adoptDocument(id, { engine = "custom", content = null } = {}) {
    const existing = getDocument(id);
    if (!existing) return null;
    const now = Date.now();
    let finalContent = content;
    if (finalContent === null || finalContent === undefined) {
      if (engine === "markitdown") {
        finalContent = existing.markitdown_md;
      } else if (engine === "docling") {
        finalContent = existing.docling_md;
      } else {
        finalContent = existing.final_content || existing.docling_md || existing.markitdown_md || "";
      }
    }

    const wordCount = (finalContent || "").replace(/\s+/g, "").length;

    db.prepare(`
      UPDATE kb_documents SET
        final_content = ?,
        adopted_engine = ?,
        accepted_at = ?,
        word_count = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      finalContent,
      engine || "custom",
      now,
      wordCount,
      now,
      id
    );

    // Sync FTS
    db.prepare("DELETE FROM kb_documents_fts WHERE doc_id = ?").run(id);
    db.prepare("INSERT INTO kb_documents_fts (doc_id, title, content) VALUES (?, ?, ?)").run(
      id,
      existing.title,
      `${finalContent} ${existing.markitdown_md} ${existing.docling_md}`
    );

    return getDocument(id);
  }

  function deleteDocument(id) {
    const existing = getDocument(id);
    if (!existing) return false;
    db.prepare("DELETE FROM kb_documents_fts WHERE doc_id = ?").run(id);
    db.prepare("DELETE FROM kb_documents WHERE id = ?").run(id);
    db.prepare("UPDATE kb_collections SET doc_count = MAX(0, doc_count - 1) WHERE id = ?").run(existing.collection_id);
    return true;
  }

  function searchDocuments(q, limit = 20) {
    if (!q || !q.trim()) return [];
    const trimmed = q.trim();
    const safeQ = trimmed.replace(/['"*]/g, " ").trim();
    if (safeQ) {
      try {
        const rows = db.prepare(`
          SELECT d.*
          FROM kb_documents_fts f
          JOIN kb_documents d ON f.doc_id = d.id
          WHERE kb_documents_fts MATCH ?
          LIMIT ?
        `).all(`"${safeQ}"*`, limit);
        if (rows.length > 0) {
          return rows.map((r) => ({
            ...r,
            assets: JSON.parse(r.assets_json || "[]"),
          }));
        }
      } catch {
        // Fallback to LIKE
      }
    }
    // Fallback to LIKE query for CJK substring matching
    const rows = db.prepare(`
      SELECT * FROM kb_documents
      WHERE title LIKE ? OR markitdown_md LIKE ? OR docling_md LIKE ? OR final_content LIKE ?
      LIMIT ?
    `).all(`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`, limit);
    return rows.map((r) => ({
      ...r,
      assets: JSON.parse(r.assets_json || "[]"),
    }));
  }

  function findDocumentBySourceUrl(url) {
    if (!url) return null;
    const row = db.prepare("SELECT * FROM kb_documents WHERE source_url = ?").get(url);
    if (!row) return null;
    return {
      ...row,
      assets: JSON.parse(row.assets_json || "[]"),
    };
  }

  function findDocumentByTitle(title) {
    if (!title) return null;
    const row = db.prepare("SELECT * FROM kb_documents WHERE title = ?").get(title);
    if (!row) return null;
    return {
      ...row,
      assets: JSON.parse(row.assets_json || "[]"),
    };
  }

  function syncVideoKbDocs({ mediaDir, filesDir }) {
    try {
      if (!mediaDir) return;
      const metaPath = path.join(mediaDir, "video-kb", "meta.sqlite");
      if (!fs.existsSync(metaPath)) return;
      const vDb = new DatabaseSync(metaPath);
      const videos = vDb.prepare("SELECT * FROM videos").all();
      for (const v of videos) {
        const title = v.display_title || v.source_title || v.video_title || "视频知识库文档";
        const url = v.video_url || "";
        const existing = (url ? findDocumentBySourceUrl(url) : null) || findDocumentByTitle(title);
        if (!existing) {
          const duration = v.duration ? `${Math.round(v.duration)}秒` : "";
          const lang = v.language || "zh";
          const lines = [`# ${title}\n`];
          if (url || duration || lang) {
            lines.push(`> 来源链接: ${url ? `[${url}](${url})` : "本地音视频"}  `);
            if (duration) lines.push(`> 视频时长: ${duration} | 语言识别: ${lang || '自动识别'}  `);
            lines.push("");
          }
          if (v.summary_full || v.summary_short) {
            lines.push(`## 视频摘要\n`);
            lines.push(v.summary_full || v.summary_short || "");
            lines.push("");
          }
          let keyPoints = [];
          try { keyPoints = JSON.parse(v.key_points_json || "[]"); } catch {}
          if (Array.isArray(keyPoints) && keyPoints.length > 0) {
            lines.push(`## 核心要点\n`);
            keyPoints.forEach((kp) => lines.push(`- ${kp}`));
            lines.push("");
          }
          const markdown = lines.join("\n");
          const newDoc = createDocument({
            collection_id: "col_default",
            title,
            source_type: "video",
            source_url: url,
            doc_type: "video",
            final_content: markdown,
            markitdown_md: markdown,
            docling_md: markdown,
            word_count: markdown.length,
            accepted_at: v.created_at || Date.now(),
          });
          if (filesDir) {
            const docDir = path.join(filesDir, newDoc.id);
            if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
            fs.writeFileSync(path.join(docDir, "final.md"), markdown, "utf-8");
          }
        }
      }
      vDb.close();
    } catch (err) {
      console.warn("syncVideoKbDocs error:", err.message);
    }
  }

  function close() {
    db.close();
  }

  return {
    init,
    createCollection,
    listCollections,
    getCollection,
    updateCollection,
    deleteCollection,
    createDocument,
    getDocument,
    findDocumentBySourceUrl,
    findDocumentByTitle,
    syncVideoKbDocs,
    listDocuments,
    updateDocumentResult,
    adoptDocument,
    deleteDocument,
    searchDocuments,
    close,
  };
}
