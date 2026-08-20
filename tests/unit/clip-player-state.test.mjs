import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClipPlayback } from "../../lib/video-kb/clip-player-state.mjs";

test("normalizeClipPlayback rejects inverted range", () => {
  const result = normalizeClipPlayback({
    video_id: "v1",
    start_seconds: 20,
    end_seconds: 10,
  });
  assert.equal(result.ok, false);
});

test("normalizeClipPlayback builds local asset src", () => {
  const result = normalizeClipPlayback({
    video_id: "v1",
    start_seconds: 12.4,
    end_seconds: 40,
    title: "谦 初六",
    quote: "山藏在地里",
  });
  assert.equal(result.ok, true);
  assert.equal(result.src, "/v1/video-kb/assets/v1/video");
  assert.equal(result.start_seconds, 12.4);
  assert.equal(result.end_seconds, 40);
});
