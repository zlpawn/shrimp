import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createKbStore } from "../../lib/knowledge-base/kb-store.mjs";

test("KbStore: CRUD collections and documents with FTS5 search", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-store-test-"));
  const dbPath = path.join(tmpDir, "test-kb.db");
  const store = createKbStore({ dbPath });
  store.init();

  // Test collection creation and retrieval
  const col = store.createCollection({
    id: "col_test",
    name: "测试知识库",
    description: "用于测试的集合",
    icon: "folder",
    color: "#3b82f6",
  });
  assert.equal(col.id, "col_test");
  assert.equal(col.name, "测试知识库");

  const cols = store.listCollections();
  assert.equal(cols.length >= 1, true);
  assert.equal(cols.some(c => c.id === "col_test"), true);

  // Test document creation
  const doc = store.createDocument({
    id: "doc_001",
    collection_id: "col_test",
    title: "深度学习研报.pdf",
    source_type: "file",
    file_name: "深度学习研报.pdf",
    file_path: "/tmp/fake.pdf",
    file_size: 1024,
    file_hash: "hash123",
  });
  assert.equal(doc.id, "doc_001");
  assert.equal(doc.title, "深度学习研报.pdf");

  // Check document count in collection
  const colUpdated = store.getCollection("col_test");
  assert.equal(colUpdated.doc_count, 1);

  // Test update parse results
  store.updateDocumentResult("doc_001", {
    markitdown_status: "done",
    markitdown_md: "# MarkItDown 深度学习研报内容",
    markitdown_duration_ms: 250,
    docling_status: "done",
    docling_md: "# Docling 深度学习研报详细内容与表格",
    docling_html: "<h1>Docling 深度学习研报详细内容与表格</h1>",
    docling_json: JSON.stringify({ pages: 5 }),
    docling_duration_ms: 2400,
    word_count: 500,
  });

  const updatedDoc = store.getDocument("doc_001");
  assert.equal(updatedDoc.markitdown_status, "done");
  assert.equal(updatedDoc.docling_status, "done");
  assert.equal(updatedDoc.word_count, 500);

  // Test search via FTS5
  const searchResults = store.searchDocuments("研报");
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, "doc_001");

  // Test collection update (rename)
  const updatedCol = store.updateCollection("col_test", {
    name: "深度学习专栏",
    description: "更新后的描述",
  });
  assert.equal(updatedCol.name, "深度学习专栏");
  assert.equal(store.getCollection("col_test").name, "深度学习专栏");

  // Test collection deletion
  store.deleteCollection("col_test");
  assert.equal(store.getCollection("col_test"), null);

  // Clean up
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
