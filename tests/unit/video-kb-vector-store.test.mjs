import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createVectorStore, ensureLanceColumns } from "../../lib/video-kb/vector-store.mjs";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "lancedb-"));
}

test("vector-store: createVectorStore returns all expected methods", () => {
  const store = createVectorStore({ dbPath: "/tmp/test" });
  assert.equal(typeof store.ensureTable, "function");
  assert.equal(typeof store.upsertChunks, "function");
  assert.equal(typeof store.search, "function");
  assert.equal(typeof store.deleteByVideo, "function");
  assert.equal(typeof store.listVideos, "function");
  assert.equal(typeof store.getVideo, "function");
  assert.equal(typeof store.getStats, "function");
});

test("vector-store: ensure table and upsert chunks", async () => {
  const dir = tmpDir();
  try {
    const store = createVectorStore({ dbPath: dir });
    await store.ensureTable(3);

    const chunks = [
      {
        chunk_id: "chunk-001",
        video_id: "vid001",
        video_url: "https://example.com/v1",
        video_title: "Test Video",
        chunk_index: 0,
        start_seconds: 0,
        end_seconds: 60,
        text: "This is a test about cooking",
        segment_ids: ["S1", "S2"],
        language: "en",
        created_at: Date.now(),
        vector: [1.0, 0.0, 0.0],
      },
      {
        chunk_id: "chunk-002",
        video_id: "vid001",
        video_url: "https://example.com/v1",
        video_title: "Test Video",
        chunk_index: 1,
        start_seconds: 60,
        end_seconds: 120,
        text: "This is about programming",
        segment_ids: ["S3", "S4"],
        language: "en",
        created_at: Date.now(),
        vector: [0.0, 1.0, 0.0],
      },
    ];

    const result = await store.upsertChunks(chunks, { dim: 3 });
    assert.ok(result.ok);
    assert.equal(result.count, 2);

    const stats = await store.getStats();
    assert.equal(stats.total_chunks, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vector-store: search returns similar chunks", async () => {
  const dir = tmpDir();
  try {
    const mockEmbed = async (text) => {
      if (text.toLowerCase().includes("cooking")) return [1.0, 0.0, 0.0];
      if (text.toLowerCase().includes("programming")) return [0.0, 1.0, 0.0];
      return [0.5, 0.5, 0.0];
    };

    const store = createVectorStore({ dbPath: dir, embeddingFn: mockEmbed });
    await store.ensureTable(3);

    await store.upsertChunks([
      {
        chunk_id: "c1", video_id: "v1", video_url: "u1", video_title: "Cooking Show",
        chunk_index: 0, start_seconds: 0, end_seconds: 60,
        text: "cooking pasta recipe", segment_ids: ["s1"], language: "en",
        created_at: Date.now(), vector: [1, 0, 0],
      },
      {
        chunk_id: "c2", video_id: "v1", video_url: "u1", video_title: "Cooking Show",
        chunk_index: 1, start_seconds: 60, end_seconds: 120,
        text: "programming in python", segment_ids: ["s2"], language: "en",
        created_at: Date.now(), vector: [0, 1, 0],
      },
    ], { dim: 3 });

    const results = await store.search("how to cook", { topK: 1 });
    assert.equal(results.length, 1);
    assert.ok(results[0].text.includes("cooking"));
    assert.equal(results[0].video_title, "Cooking Show");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vector-store: list and delete videos", async () => {
  const dir = tmpDir();
  try {
    const store = createVectorStore({ dbPath: dir });
    await store.ensureTable(3);

    await store.upsertChunks([
      {
        chunk_id: "c1", video_id: "v1", video_url: "u1", video_title: "Video 1",
        chunk_index: 0, start_seconds: 0, end_seconds: 60,
        text: "content 1", segment_ids: ["s1"], language: "en",
        created_at: Date.now(), vector: [1, 0, 0],
      },
      {
        chunk_id: "c2", video_id: "v2", video_url: "u2", video_title: "Video 2",
        chunk_index: 0, start_seconds: 0, end_seconds: 30,
        text: "content 2", segment_ids: ["s2"], language: "en",
        created_at: Date.now(), vector: [0, 1, 0],
      },
    ], { dim: 3 });

    const videos = await store.listVideos();
    assert.equal(videos.length, 2);

    await store.deleteByVideo("v1");
    const videosAfter = await store.listVideos();
    assert.equal(videosAfter.length, 1);
    assert.equal(videosAfter[0].video_id, "v2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vector-store: getVideo returns chunks sorted by index", async () => {
  const dir = tmpDir();
  try {
    const store = createVectorStore({ dbPath: dir });
    await store.ensureTable(3);

    await store.upsertChunks([
      {
        chunk_id: "c1", video_id: "v1", video_url: "u1", video_title: "Test",
        chunk_index: 1, start_seconds: 60, end_seconds: 120,
        text: "second chunk", segment_ids: ["s2"], language: "en",
        created_at: Date.now(), vector: [0, 1, 0],
      },
      {
        chunk_id: "c2", video_id: "v1", video_url: "u1", video_title: "Test",
        chunk_index: 0, start_seconds: 0, end_seconds: 60,
        text: "first chunk", segment_ids: ["s1"], language: "en",
        created_at: Date.now(), vector: [1, 0, 0],
      },
    ], { dim: 3 });

    const result = await store.getVideo("v1");
    assert.equal(result.chunk_count, 2);
    assert.equal(result.chunks[0].chunk_index, 0);
    assert.equal(result.chunks[1].chunk_index, 1);
    assert.equal(result.chunks[0].text, "first chunk");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vector-store: search can filter by collection", async () => {
  const dir = tmpDir();
  try {
    const mockEmbed = async (text) => {
      if (text.includes("qian")) return [1, 0, 0];
      return [0, 1, 0];
    };
    const store = createVectorStore({ dbPath: dir, embeddingFn: mockEmbed });
    await store.upsertChunks([
      {
        chunk_id: "c1",
        video_id: "v1",
        collection: "iching-up",
        text: "qian hexagram intro",
        start_seconds: 10,
        end_seconds: 20,
        vector: [1, 0, 0],
      },
      {
        chunk_id: "c2",
        video_id: "v2",
        collection: "other-course",
        text: "qian mentioned in passing",
        start_seconds: 0,
        end_seconds: 8,
        vector: [1, 0, 0],
      },
    ], { dim: 3 });

    const all = await store.search("qian", { topK: 5 });
    assert.equal(all.length, 2);
    const filtered = await store.search("qian", { topK: 5, collection: "iching-up" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].video_id, "v1");
    assert.equal(filtered[0].collection, "iching-up");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vector-store: old tables without collection still search and accept new writes", async () => {
  const dir = tmpDir();
  try {
    const mockEmbed = async () => [1, 0, 0];
    const lancedb = (await import("@lancedb/lancedb")).default || await import("@lancedb/lancedb");
    const db = await lancedb.connect(dir);
    await db.createTable("video_kb", [{
      chunk_id: "old-1",
      video_id: "old-v",
      video_url: "https://example.com/old",
      video_title: "Old Video",
      chunk_index: 0,
      start_seconds: 0,
      end_seconds: 10,
      text: "qian hexagram from old schema",
      segment_ids: ["s1"],
      language: "zh",
      created_at: Date.now(),
      vector: [1, 0, 0],
    }]);

    const store = createVectorStore({ dbPath: dir, embeddingFn: mockEmbed });
    const all = await store.search("qian", { topK: 5 });
    assert.equal(all.length, 1);
    assert.equal(all[0].video_id, "old-v");
    assert.equal(all[0].collection, "default");

    const filtered = await store.search("qian", { topK: 5, collection: "default" });
    assert.equal(filtered.length, 1);

    const written = await store.upsertChunks([{
      chunk_id: "new-1",
      video_id: "new-v",
      collection: "iching-up",
      text: "qian hexagram new write",
      start_seconds: 0,
      end_seconds: 8,
      vector: [1, 0, 0],
    }], { dim: 3 });
    assert.equal(written.ok, true);

    const iching = await store.search("qian", { topK: 5, collection: "iching-up" });
    assert.equal(iching.length, 1);
    assert.equal(iching[0].video_id, "new-v");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vector-store: ensureLanceColumns adds only missing columns", async () => {
  const added = [];
  const table = {
    async schema() {
      return { fields: [{ name: "chunk_id" }, { name: "video_id" }] };
    },
    async addColumns(cols) {
      added.push(...cols.map((col) => col.name));
    },
  };
  const names = await ensureLanceColumns(table, [
    { name: "collection", valueSql: "'default'" },
    { name: "video_id", valueSql: "''" },
    { name: "source", valueSql: "'manual'" },
  ]);
  assert.deepEqual(names, ["collection", "source"]);
  assert.deepEqual(added, ["collection", "source"]);
});
