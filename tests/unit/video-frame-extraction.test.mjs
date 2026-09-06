import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSecondsToTimestamp,
  buildFfmpegExtractArgs,
} from "../../lib/video-kb/downloader.mjs";

describe("Video Frame Extraction & Timestamp Helper", () => {
  it("formats seconds to MM:SS and HH:MM:SS correctly", () => {
    assert.equal(formatSecondsToTimestamp(0), "00:00");
    assert.equal(formatSecondsToTimestamp(45), "00:45");
    assert.equal(formatSecondsToTimestamp(65), "01:05");
    assert.equal(formatSecondsToTimestamp(258), "04:18");
    assert.equal(formatSecondsToTimestamp(3665), "01:01:05");
  });

  it("builds ffmpeg args for interval strategy", () => {
    const args = buildFfmpegExtractArgs("test.mp4", "out/frame_%04d.jpg", {
      strategy: "interval",
      interval: 5,
      maxFrames: 30,
      scale: "-1:720",
    });

    assert.ok(args.includes("-i"));
    assert.ok(args.includes("test.mp4"));
    assert.ok(args.includes("fps=0.2000,scale=-1:720"));
    assert.ok(args.includes("-vframes"));
    assert.ok(args.includes("30"));
    assert.equal(args[args.length - 1], "out/frame_%04d.jpg");
  });

  it("builds ffmpeg args for scene detection strategy", () => {
    const args = buildFfmpegExtractArgs("video.mp4", "out/frame_%04d.jpg", {
      strategy: "scene",
      sceneThreshold: 0.35,
      maxFrames: 50,
      scale: "-1:720",
    });

    assert.ok(args.includes("-i"));
    assert.ok(args.includes("video.mp4"));
    assert.ok(args.includes("select='gt(scene,0.35)',scale=-1:720"));
    assert.ok(args.includes("-vsync"));
    assert.ok(args.includes("vfr"));
    assert.ok(args.includes("-vframes"));
    assert.ok(args.includes("50"));
  });

  it("handles local video/audio files in fetchVideoInfo and downloadVideo", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { fetchVideoInfo, downloadVideo } = await import("../../lib/video-kb/downloader.mjs");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-kb-test-"));
    const dummyAudio = path.join(tmpDir, "meeting_recording.mp3");
    fs.writeFileSync(dummyAudio, "ID3 mock audio data", "utf8");

    try {
      // 1. fetchVideoInfo with local file
      const info = await fetchVideoInfo(dummyAudio);
      assert.equal(info.title, "meeting_recording");
      assert.equal(info.extractor, "local_file");
      assert.equal(info.uploader, "local");

      // 2. downloadVideo with audioOnly: true on an audio file
      const outDir = path.join(tmpDir, "output");
      const dlRes = await downloadVideo(dummyAudio, {
        outputDir: outDir,
        audioOnly: true,
      });
      assert.equal(dlRes.audioPath, dummyAudio);
      assert.equal(dlRes.info.title, "meeting_recording");
      assert.equal(dlRes.info.extractor, "local_file");
      assert.ok(fs.existsSync(dlRes.infoPath));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
