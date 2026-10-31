import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { parseCliArgs } from "../../lib/skills/leo-apimart-video/scripts/leo_apimart_video.mjs";
import { OPERATIONS, buildPayload } from "../../lib/skills/leo-apimart-video/scripts/lib/operations.mjs";
import {
  extractTaskId,
  collectOutputs,
  planOutputFiles,
  extFromUrl,
  generateBaseName,
} from "../../lib/skills/leo-apimart-video/scripts/lib/task.mjs";
import { normalizeApiUrl, loadConfig, saveConfig, maskApiKey } from "../../lib/skills/leo-apimart-video/scripts/lib/config.mjs";
import { findLocalFiles, mapLocalFiles } from "../../lib/skills/leo-apimart-video/scripts/lib/tunnel.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(ROOT, "lib", "skills", "leo-apimart-video", "scripts", "leo_apimart_video.mjs");

function withTempConfig(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apimart-video-"));
  const prev = process.env.LEO_APIMART_VIDEO_CONFIG_PATH;
  process.env.LEO_APIMART_VIDEO_CONFIG_PATH = path.join(dir, "config.json");
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.LEO_APIMART_VIDEO_CONFIG_PATH;
    else process.env.LEO_APIMART_VIDEO_CONFIG_PATH = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args) {
  return execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", env: process.env });
}

test("SKILL.md has frontmatter name and documents every operation", () => {
  const md = fs.readFileSync(path.join(ROOT, "lib", "skills", "leo-apimart-video", "SKILL.md"), "utf8");
  assert.match(md, /^---\nname: leo-apimart-video\n/);
  for (const name of Object.keys(OPERATIONS)) assert.match(md, new RegExp(`\`${name}`));
});

test("parseCliArgs: commands, positionals, typed --set values, numeric duration", () => {
  const a = parseCliArgs(["--model", "m", "--prompt", "p", "--duration", "6", "--images", "a.png, https://x/b.png",
    "--set", "audio=true", "--set", "mode=pro", "--set", "tags=[\"x\"]", "--no-wait", "--idempotency-key", "k1"]);
  assert.equal(a.command, "generate");
  assert.equal(a.duration, 6);
  assert.deepEqual(a.imagePaths, ["a.png", "https://x/b.png"]);
  assert.deepEqual(a.set, { audio: true, mode: "pro", tags: ["x"] });
  assert.equal(a.idempotencyKey, "k1");
  const r = parseCliArgs(["remix", "task_9", "--model", "veo3.1-fast"]);
  assert.equal(r.command, "remix");
  assert.equal(r.taskId, "task_9");
  assert.equal(parseCliArgs(["status", "task_1"]).taskId, "task_1");
  assert.equal(parseCliArgs(["upload", "x.png"]).uploadPath, "x.png");
  assert.equal(parseCliArgs(["config", "set", "--api-key", "k"]).configAction, "set");
  assert.throws(() => parseCliArgs(["--bogus"]), /未知参数/);
  assert.throws(() => parseCliArgs(["bogus"]), /未知命令/);
  assert.throws(() => parseCliArgs(["--set", "novalue"]), /key=value/);
});

test("OPERATIONS map to documented endpoints", () => {
  assert.equal(OPERATIONS.generate.path({}), "/videos/generations");
  assert.equal(OPERATIONS.remix.path({ taskId: "task_1" }), "/videos/task_1/remix");
  assert.equal(OPERATIONS.remix.requireModel, true);
});

test("buildPayload maps flags 1:1, omits empty prompt, --set overrides", () => {
  const args = parseCliArgs(["--prompt", "p", "--size", "16:9", "--duration", "6", "--resolution", "720p", "--set", "size=9:16"]);
  assert.deepEqual(buildPayload(args, "grok-imagine-1.5-video-ext", ["https://u/1.png"]), {
    model: "grok-imagine-1.5-video-ext", prompt: "p", size: "9:16", duration: 6, resolution: "720p",
    image_urls: ["https://u/1.png"],
  });
  assert.deepEqual(buildPayload(parseCliArgs(["--aspect-ratio", "16:9"]), "kling-v3"), { model: "kling-v3", aspect_ratio: "16:9" });
  assert.deepEqual(buildPayload(parseCliArgs(["--set", "source_task_id=t1"]), "MiniMax-H3-Regeneration"),
    { model: "MiniMax-H3-Regeneration", source_task_id: "t1" });
});

test("extractTaskId handles documented and unified shapes", () => {
  assert.equal(extractTaskId({ code: 200, data: [{ task_id: "t1", status: "submitted" }] }), "t1");
  assert.equal(extractTaskId({ code: 202, data: { id: "t2" } }), "t2");
  assert.equal(extractTaskId({ data: [] }), null);
});

test("collectOutputs: multiple videos, url arrays/strings, images, Context-IR text", () => {
  assert.deepEqual(collectOutputs({ result: { videos: [{ url: ["https://c/a.mp4"], expires_at: 1 }, { url: "https://c/b.mov" }, "https://c/c.mp4"] } }),
    { videos: ["https://c/a.mp4", "https://c/b.mov", "https://c/c.mp4"], images: [], text: null });
  assert.deepEqual(collectOutputs({ result: { videos: [{ url: ["https://c/v.mp4"] }], images: [{ url: ["https://c/last.png"] }] } }),
    { videos: ["https://c/v.mp4"], images: ["https://c/last.png"], text: null });
  assert.deepEqual(collectOutputs({ result: { prompt: "enhanced" } }), { videos: [], images: [], text: "enhanced" });
  assert.deepEqual(collectOutputs({}), { videos: [], images: [], text: null });
});

test("planOutputFiles names multi-output files and keeps extensions", () => {
  const files = planOutputFiles({ videos: ["https://c/a.mp4", "https://c/b.mov?sig=1"], images: ["https://c/x.webp"], text: "t" },
    { outputDir: "/out", filename: "clip.mp4" });
  assert.deepEqual(files.map((f) => [f.kind, f.path]), [
    ["video", "/out/clip_1.mp4"],
    ["video", "/out/clip_2.mov"],
    ["image", "/out/clip_image.webp"],
    ["text", "/out/clip.txt"],
  ]);
  const single = planOutputFiles({ videos: ["https://c/noext"], images: [], text: null }, { outputDir: "/o", filename: "one" });
  assert.equal(single[0].path, "/o/one.mp4");
  assert.equal(extFromUrl("https://c/b.MOV", "mp4"), "mov");
});

test("generateBaseName and normalizeApiUrl", () => {
  assert.equal(generateBaseName("海边 小狗!", new Date(2026, 0, 2, 3, 4, 5)), "apimart_海边_小狗_20260102030405");
  assert.equal(normalizeApiUrl("https://api.apimart.ai/"), "https://api.apimart.ai/v1");
  assert.equal(normalizeApiUrl(undefined), "https://api.apimart.ai/v1");
});

test("config save/load writes 0600 and masks key", () => withTempConfig(() => {
  saveConfig({ api_key: "sk-1234567890", default_model: "m" });
  assert.equal(fs.statSync(process.env.LEO_APIMART_VIDEO_CONFIG_PATH).mode & 0o777, 0o600);
  assert.equal(loadConfig().api_url, "https://api.apimart.ai/v1");
  assert.equal(maskApiKey("sk-1234567890"), "sk-1...7890");
}));

test("CLI dry-run: generate uploads nothing, prints idempotency key, never leaks the API key", () => withTempConfig((dir) => {
  saveConfig({ api_key: "sk-test-key-000", default_model: "grok-imagine-1.5-video-ext" });
  const img = path.join(dir, "ref.png");
  fs.writeFileSync(img, "x");
  const out = runCli(["--prompt", "p", "--size", "16:9", "--images", img, "--idempotency-key", "fixed-key", "--dry-run"]);
  assert.match(out, /POST https:\/\/api\.apimart\.ai\/v1\/videos\/generations/);
  assert.match(out, /Idempotency-Key: fixed-key/);
  assert.match(out, /"model": "grok-imagine-1.5-video-ext"/);
  assert.match(out, /<upload:/);
  assert.doesNotMatch(out, /sk-test-key-000/);
}));

test("CLI dry-run: remix hits /videos/{id}/remix and refuses the default model", () => withTempConfig(() => {
  saveConfig({ api_key: "sk-test-key-000", default_model: "grok-imagine-1.5-video-ext" });
  const out = runCli(["remix", "task_abc", "--model", "veo3.1-fast", "--prompt", "go on", "--dry-run"]);
  assert.match(out, /POST https:\/\/api\.apimart\.ai\/v1\/videos\/task_abc\/remix/);
  assert.throws(() => runCli(["remix", "task_abc", "--prompt", "go on", "--dry-run"]), /必须显式传 --model/);
}));

test("mapLocalFiles replaces local paths anywhere except model/prompt", () => withTempConfig((dir) => {
  const vid = path.join(dir, "ref.mp4");
  const aud = path.join(dir, "bgm.mp3");
  fs.writeFileSync(vid, "v");
  fs.writeFileSync(aud, "a");
  const payload = {
    model: "seedance-2.0", prompt: vid, video_urls: [vid, "https://x/v.mp4"], audio_url: aud,
    image_with_roles: [{ url: vid, role: "first_frame" }], duration: 5, note: "not-a-file.mp4",
  };
  assert.deepEqual(findLocalFiles(payload), [vid, aud]);
  const mapped = mapLocalFiles(payload, (f) => `https://t/${path.basename(f)}`);
  assert.equal(mapped.prompt, vid);
  assert.deepEqual(mapped.video_urls, ["https://t/ref.mp4", "https://x/v.mp4"]);
  assert.equal(mapped.audio_url, "https://t/bgm.mp3");
  assert.deepEqual(mapped.image_with_roles, [{ url: "https://t/ref.mp4", role: "first_frame" }]);
  assert.equal(mapped.note, "not-a-file.mp4");
  assert.equal(mapped.duration, 5);
}));

test("CLI: local video in --set shows <tunnel:> in dry-run and is refused with --no-wait", () => withTempConfig((dir) => {
  saveConfig({ api_key: "sk-test-key-000", default_model: "seedance-2.0" });
  const vid = path.join(dir, "ref.mp4");
  fs.writeFileSync(vid, "v");
  const out = runCli(["--prompt", "p", "--set", `video_urls=${JSON.stringify([vid])}`, "--dry-run"]);
  assert.match(out, new RegExp(`<tunnel:${vid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`));
  assert.throws(() => runCli(["--prompt", "p", "--set", `video_urls=${JSON.stringify([vid])}`, "--no-wait"]), /--no-wait/);
}));
