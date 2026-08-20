import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClipAnchorStore } from "../../lib/video-kb/clip-anchors.mjs";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "clip-anchors-"));
}

test("clip-anchors: reject inverted time range", () => {
  const dir = tmpDir();
  try {
    const store = createClipAnchorStore({ dbPath: path.join(dir, "meta.sqlite") });
    assert.throws(() => store.upsertAnchor({
      collection: "iching-up",
      object_type: "line",
      object_id: "谦/初六",
      video_id: "v1",
      start_seconds: 20,
      end_seconds: 10,
    }), /end_seconds/);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clip-anchors: display query hides mentions and low confidence", () => {
  const dir = tmpDir();
  try {
    const store = createClipAnchorStore({ dbPath: path.join(dir, "meta.sqlite") });
    store.upsertAnchor({
      id: "a1",
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "谦",
      video_id: "v1",
      start_seconds: 12,
      end_seconds: 40,
      quote: "山藏在地里",
      role: "primary",
      confidence: 0.9,
      confirmed: 0,
      source: "model",
    });
    store.upsertAnchor({
      id: "a2",
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "乾",
      video_id: "v1",
      start_seconds: 40,
      end_seconds: 50,
      quote: "和前面乾卦一样",
      role: "mention",
      confidence: 0.99,
      confirmed: 1,
      source: "model",
    });
    store.upsertAnchor({
      id: "a3",
      collection: "iching-up",
      object_type: "line",
      object_id: "谦/初六",
      video_id: "v1",
      start_seconds: 50,
      end_seconds: 80,
      quote: "最底下先自收",
      role: "primary",
      confidence: 0.4,
      confirmed: 0,
      source: "model",
    });
    const displayed = store.listAnchors({
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "谦",
      for_display: true,
    });
    assert.equal(displayed.length, 1);
    assert.equal(displayed[0].id, "a1");
    assert.equal(store.listAnchors({
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "乾",
      for_display: true,
    }).length, 0);
    assert.equal(store.listAnchors({
      collection: "iching-up",
      object_type: "line",
      object_id: "谦/初六",
      for_display: true,
    }).length, 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clip-anchors: unique clip is upserted instead of duplicated", () => {
  const dir = tmpDir();
  try {
    const store = createClipAnchorStore({ dbPath: path.join(dir, "meta.sqlite") });
    const first = store.upsertAnchor({
      id: "a-old",
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "谦",
      video_id: "v1",
      start_seconds: 12,
      end_seconds: 40,
      quote: "first",
      role: "primary",
      confidence: 0.9,
      source: "model",
    });
    const second = store.upsertAnchor({
      id: "a-new",
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "谦",
      video_id: "v1",
      start_seconds: 12,
      end_seconds: 40,
      quote: "updated quote",
      role: "primary",
      confidence: 0.95,
      confirmed: 1,
      source: "manual",
    });
    assert.equal(second.id, first.id);
    assert.equal(second.quote, "updated quote");
    assert.equal(second.confirmed, 1);
    const listed = store.listAnchors({
      collection: "iching-up",
      object_type: "hexagram",
      object_id: "谦",
    });
    assert.equal(listed.length, 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
