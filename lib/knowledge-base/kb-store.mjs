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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS kb_documents_fts USING fts5(
        doc_id UNINDEXED,
        title,
        content
      );
    `);

    // Ensure default collection exists
    const defaultCol = getCollection("col_default");
    if (!defaultCol) {
      createCollection({
        id: "col_default",
        name: "默认知识库",
        description: "未分类文档的默认归宿",
        icon: "folder",
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
      icon: col.icon || "folder",
      color: col.color || "#3b82f6",
      doc_count: col.doc_count || 0,
      created_at: col.created_at || now,
      updated_at: col.updated_at || now,
    };
    db.prepare(`
      INSERT INTO kb_collections (id, name, description, icon, color, doc_count, created_at, updated_at)
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
      created_at: doc.created_at || now,
      updated_at: doc.updated_at || now,
    };

    db.prepare(`
      INSERT INTO kb_documents (
        id, collection_id, title, source_type, source_url, file_name, file_path, file_size, file_hash,
        markitdown_status, markitdown_md, markitdown_html, markitdown_duration_ms, markitdown_error,
        docling_status, docling_md, docling_html, docling_json, docling_duration_ms, docling_error,
        assets_json, word_count, adopted_engine, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `).run(
      item.id, item.collection_id, item.title, item.source_type, item.source_url, item.file_name, item.file_path, item.file_size, item.file_hash,
      item.markitdown_status, item.markitdown_md, item.markitdown_html, item.markitdown_duration_ms, item.markitdown_error,
      item.docling_status, item.docling_md, item.docling_html, item.docling_json, item.docling_duration_ms, item.docling_error,
      item.assets_json, item.word_count, item.adopted_engine, item.created_at, item.updated_at
    );

    // Sync FTS5
    db.prepare("INSERT INTO kb_documents_fts (doc_id, title, content) VALUES (?, ?, ?)").run(
      item.id,
      item.title,
      `${item.markitdown_md} ${item.docling_md}`
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

  function listDocuments({ collection_id = null, limit = 50, offset = 0 } = {}) {
    let query = "SELECT * FROM kb_documents";
    const params = [];
    if (collection_id) {
      query += " WHERE collection_id = ?";
      params.push(collection_id);
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
      updated.updated_at,
      id
    );

    // Update FTS
    db.prepare("DELETE FROM kb_documents_fts WHERE doc_id = ?").run(id);
    db.prepare("INSERT INTO kb_documents_fts (doc_id, title, content) VALUES (?, ?, ?)").run(
      id,
      updated.title,
      `${updated.markitdown_md} ${updated.docling_md}`
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
      WHERE title LIKE ? OR markitdown_md LIKE ? OR docling_md LIKE ?
      LIMIT ?
    `).all(`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`, limit);
    return rows.map((r) => ({
      ...r,
      assets: JSON.parse(r.assets_json || "[]"),
    }));
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
    listDocuments,
    updateDocumentResult,
    deleteDocument,
    searchDocuments,
    close,
  };
}
