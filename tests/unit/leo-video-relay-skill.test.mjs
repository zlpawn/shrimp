import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeStatus, validateDraft } from "../../lib/skills/leo-video-relay/scripts/lib/facts.mjs";
import { framesPublicByDefault, splitNote } from "../../lib/skills/leo-video-relay/scripts/lib/craft.mjs";
import { isMachineTranslated, keepSegment, maxIntervalFor, parseCues, planFrames, selectDistinctFrames } from "../../lib/skills/leo-video-relay/scripts/lib/media.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL = path.join(ROOT, "lib", "skills", "leo-video-relay");
const SCRIPT = path.join(SKILL, "scripts", "relay.mjs");

const frame = (id, t, review = "detail") => ({ id, t, review, path: `frames/${id}.jpg` });

function baseAudit(overrides = {}) {
  return {
    duration: 100,
    audio: { status: "ok" },
    subtitles: [],
    visual: { status: "complete" },
    frames: [frame("FRAME-0001", 10)],
    ...overrides,
  };
}

const evidence = (audit) => ({
  speech: new Map([["ASR-S00001", { id: "ASR-S00001", start: 8, end: 12, text: "x" }]]),
  frames: new Map(audit.frames.map((f) => [f.id, f])),
});

function baseDraft(overrides = {}) {
  return {
    type: "技术讲解",
    topic: "主题",
    sections: [{ start: 0, end: 100, title: "全部", fact_ids: ["FACT-0001"] }],
    facts: [{ id: "FACT-0001", kind: "speech", text: "说了 x", start: 8, end: 12, evidence: ["ASR-S00001"] }],
    ...overrides,
  };
}

const errorsFor = (draft, audit = baseAudit()) => validateDraft(draft, audit, evidence(audit));

test("frame plan never leaves a gap above the interval, including long shots", () => {
  const duration = 95;
  const plan = planFrames({ duration, cuts: [10, 10.5, 60], maxInterval: 5 });
  const times = plan.map((p) => p.t);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] - times[i - 1] <= 5 + 1e-6, `gap at ${times[i]}`);
  assert.ok(times[0] <= 5);
  assert.ok(duration - times.at(-1) <= 1);
  assert.ok(plan.some((p) => p.reason === "shot"));
  assert.ok(plan.some((p) => p.reason === "interval"));
});

test("frame interval tiers follow video length", () => {
  assert.deepEqual([60, 600, 3600, 9000].map(maxIntervalFor), [1, 5, 15, 30]);
});

test("cue parser reads SRT and VTT and folds rolling auto captions", () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,500\n<i>你好</i>\n\n2\n01:00:00,000 --> 01:00:01,000\n世界\n";
  assert.deepEqual(parseCues(srt), [{ start: 1, end: 2.5, text: "你好" }, { start: 3600, end: 3601, text: "世界" }]);
  const vtt = "WEBVTT\n\n00:01.000 --> 00:02.000\nhello\n\n00:02.000 --> 00:02.010\nhello\n\n00:02.010 --> 00:03.000\nhello\nworld\n";
  assert.deepEqual(parseCues(vtt), [{ start: 1, end: 2.01, text: "hello" }, { start: 2.01, end: 3, text: "world" }]);
});

test("frame dedupe ignores a webcam inset but keeps a small whiteboard edit", () => {
  const blank = () => new Uint8Array(96 * 54).fill(200);
  const webcam = (grid, seed) => { for (let c = 0; c < 200; c += 1) grid[c] = (seed * 37 + c) % 255; return grid; };
  const addWord = (grid) => { for (let c = 3000; c < 3006; c += 1) grid[c] = 40; return grid; };
  const grids = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const grid = webcam(blank(), i);
    return i >= 5 ? addWord(grid) : grid;
  });
  assert.deepEqual([...selectDistinctFrames(grids)], [0, 5]);
});

test("frame dedupe keeps a cut-heavy video where the whole picture moves", () => {
  const grids = Array.from({ length: 6 }, (_, i) => new Uint8Array(96 * 54).map((_, c) => (c * (i + 3) * 17) % 255));
  assert.equal(selectDistinctFrames(grids).size, 6);
});

test("machine-translated platform captions are not treated as a source", () => {
  const info = {
    subtitles: { "en-US": [{ url: "https://x/?lang=en" }] },
    automatic_captions: { en: [{ url: "https://x/?lang=en-orig&tlang=en" }], "en-orig": [{ url: "https://x/?lang=en" }], "en-US": [{ url: "https://x/?tlang=en-US" }] },
  };
  assert.equal(isMachineTranslated(info, "en"), true);
  assert.equal(isMachineTranslated(info, "en-orig"), false);
  assert.equal(isMachineTranslated(info, "en-US"), false);
});

test("whisper silence segments are dropped by its own thresholds", () => {
  assert.equal(keepSegment({ text: "字幕由 Amara 提供", no_speech_prob: 0.9, avg_logprob: -1.5 }), false);
  assert.equal(keepSegment({ text: "真实内容", no_speech_prob: 0.9, avg_logprob: -0.2 }), true);
  assert.equal(keepSegment({ text: "  " }), false);
});

test("a clean draft passes", () => {
  assert.deepEqual(errorsFor(baseDraft()), []);
});

test("a frame only seen in a contact sheet cannot be evidence", () => {
  const audit = baseAudit({ frames: [frame("FRAME-0001", 10, "overview")] });
  const draft = baseDraft({ facts: [{ id: "FACT-0001", kind: "visual", text: "画面", start: 9, end: 11, evidence: ["FRAME-0001"] }] });
  assert.match(errorsFor(draft, audit).join("\n"), /只有 overview 级别/);
});

test("invented or mistimed evidence is rejected", () => {
  const invented = baseDraft({ facts: [{ id: "FACT-0001", kind: "speech", text: "x", start: 8, end: 12, evidence: ["ASR-S09999"] }] });
  assert.match(errorsFor(invented).join("\n"), /ASR-S09999 不存在/);
  const mistimed = baseDraft({ facts: [{ id: "FACT-0001", kind: "speech", text: "x", start: 50, end: 60, evidence: ["ASR-S00001"] }] });
  assert.match(errorsFor(mistimed).join("\n"), /不在事实的时间范围内/);
});

test("speech and visual facts need the matching kind of evidence", () => {
  const draft = baseDraft({ facts: [{ id: "FACT-0001", kind: "visual", text: "x", start: 8, end: 12, evidence: ["ASR-S00001"] }] });
  assert.match(errorsFor(draft).join("\n"), /须引用 FRAME 证据/);
});

test("sections must cover the whole timeline", () => {
  const draft = baseDraft({ sections: [{ start: 0, end: 40, title: "前半", fact_ids: ["FACT-0001"] }] });
  assert.match(errorsFor(draft).join("\n"), /没有被任何 section 覆盖/);
});

test("unreviewed frames block completion unless vision is declared blocked", () => {
  const audit = baseAudit({ frames: [frame("FRAME-0001", 10, "none")] });
  assert.match(errorsFor(baseDraft(), audit).join("\n"), /还有 1 帧未审/);
  const blocked = baseAudit({ frames: [frame("FRAME-0001", 10, "none")], visual: { status: "blocked", reason: "看不了图" } });
  assert.deepEqual(errorsFor(baseDraft(), blocked), []);
});

test("status comes from the audit and cannot be claimed by the agent", () => {
  const status = (audio, visual, subtitles = []) => computeStatus({ audio: { status: audio }, visual: { status: visual }, subtitles }).status;
  assert.equal(status("ok", "complete"), "complete");
  assert.equal(status("no_speech", "complete"), "complete");
  assert.equal(status("failed", "complete", [{ track: "zh" }]), "partial");
  assert.equal(status("failed", "complete"), "partial");
  assert.equal(status("ok", "blocked"), "partial");
  assert.equal(status("no_speech", "blocked"), "failed");
  assert.equal(status("failed", "blocked"), "failed");
  assert.equal(status("no_speech", "blocked", [{ track: "zh" }]), "partial");
});

test("note splitting keeps order, respects code fences and isolates local images", () => {
  const items = splitNote("---\ntitle: T\n---\n# T\n\n开头\n\n## 一\n正文\n\n![图](../frames/FRAME-0001.jpg)\n\n```\n## 不是标题\n![x](y.jpg)\n```\n\n## 二\n![远程](https://a.com/b.jpg)\n");
  assert.deepEqual(items.map((i) => i.type), ["text", "text", "image", "text", "text"]);
  assert.equal(items[2].path, "../frames/FRAME-0001.jpg");
  assert.match(items[3].text, /## 不是标题/);
  assert.match(items[4].text, /https:\/\/a\.com/);
});

test("frames only go to Craft by default for publicly available web videos", () => {
  assert.equal(framesPublicByDefault({ url: "https://a", availability: "public" }), true);
  assert.equal(framesPublicByDefault({ url: "https://a", availability: null }), true);
  assert.equal(framesPublicByDefault({ url: "https://a", availability: "private" }), false);
  assert.equal(framesPublicByDefault({ url: null, local_path: "/a.mp4" }), false);
});

test("the skill source names no machine-specific directory", () => {
  const files = ["SKILL.md", "references/facts-schema.md", "references/scenes/knowledge-note.md", "references/scenes/xhs-material.md", "references/scenes/short-video-material.md", "scripts/relay.mjs", "scripts/lib/store.mjs", "scripts/lib/media.mjs", "scripts/lib/facts.mjs", "scripts/lib/craft.mjs"];
  for (const file of files) {
    const text = fs.readFileSync(path.join(SKILL, file), "utf8");
    assert.doesNotMatch(text, /\/Users\/|\/home\/|[A-Z]:\\|~\/(Videos|Downloads|Documents|\.claude|\.codex|\.agents)/, file);
  }
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("local video: sidecar and embedded subtitles are found, and failed ASR degrades to partial", { skip: !hasFfmpeg }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "video-relay-subs-"));
  const env = { ...process.env, LEO_VIDEO_RELAY_HOME: path.join(tmp, "home") };
  const relay = (...args) => {
    const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  };
  try {
    const embedded = path.join(tmp, "embedded.srt");
    fs.writeFileSync(embedded, "1\n00:00:00,500 --> 00:00:01,500\n内嵌字幕\n");
    fs.writeFileSync(path.join(tmp, "片.zh.srt"), "1\n00:00:00,500 --> 00:00:01,500\n外挂字幕\n");
    const video = path.join(tmp, "片.mp4");
    // Both generators stop on their own: -shortest with a subtitle input can deadlock ffmpeg.
    execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=green:s=320x180:d=2:r=10", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-i", embedded, "-map", "0", "-map", "1", "-map", "2", "-c:s", "mov_text", video], { timeout: 30_000 });

    const { run_dir: runDir } = relay("init", video);
    const prepared = relay("prepare", runDir, "--asr-tool", "not-a-real-asr");
    assert.equal(prepared.audio.status, "failed");
    assert.deepEqual(prepared.subtitles.map((s) => s.source).sort(), ["embedded", "sidecar"]);
    assert.equal(prepared.read_these.length, 1);
    assert.match(fs.readFileSync(path.join(runDir, "subtitles", "sidecar-zh.txt"), "utf8"), /SUB-S\d+ .*外挂字幕/);

    relay("review", runDir, "--sheet", "SHEET-0001", "--note", "绿色画面");
    const sidecar = JSON.parse(fs.readFileSync(path.join(runDir, "subtitles", "sidecar-zh.json"), "utf8")).segments[0];
    fs.writeFileSync(path.join(runDir, "facts.draft.json"), JSON.stringify({
      type: "测试",
      topic: "字幕",
      sections: [{ start: 0, end: 2, title: "全片", fact_ids: ["FACT-0001"] }],
      facts: [{ id: "FACT-0001", kind: "speech", text: "字幕写着外挂字幕", start: 0.5, end: 1.5, evidence: [sidecar.id] }],
    }));
    const checked = relay("check", runDir);
    assert.equal(checked.status, "partial");
    assert.match(checked.status_reasons[0], /转写失败/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("full run on a silent synthetic video: prepare, review, check, route, publish, dedupe", { skip: !hasFfmpeg }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "video-relay-test-"));
  const env = { ...process.env, LEO_VIDEO_RELAY_HOME: path.join(tmp, "home") };
  const relay = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env });
  const json = (...args) => {
    const res = relay(...args);
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  };
  try {
    const video = path.join(tmp, "演示.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=red:s=320x180:d=3:r=10", "-f", "lavfi", "-i", "color=blue:s=320x180:d=3:r=10",
      "-filter_complex", "[0][1]concat=n=2:v=1", video], { timeout: 30_000 });

    const init = json("init", video);
    assert.equal(init.status, "new");
    const runDir = init.run_dir;
    const prepared = json("prepare", runDir);
    assert.equal(prepared.audio.status, "no_speech");
    assert.ok(prepared.frames.kept >= 2, "both colours survive dedupe");
    assert.ok(prepared.frames.kept < prepared.frames.candidates, "static frames are deduped");
    assert.ok(prepared.frames.cuts >= 1);

    const next = relay("review", runDir, "--next");
    assert.match(next.stdout, /SHEET-0001/);
    assert.match(next.stdout, /r1c1 FRAME-0001/);

    assert.equal(relay("check", runDir).status, 1, "no draft yet");
    assert.equal(relay("review", runDir, "--sheet", "SHEET-0001").status, 1, "a note is required");
    json("review", runDir, "--sheet", "SHEET-0001", "--note", "红色然后蓝色");
    const audit = JSON.parse(fs.readFileSync(path.join(runDir, "audit.json"), "utf8"));
    assert.equal(audit.visual.status, "complete");
    const first = audit.frames[0];
    json("review", runDir, "--detail", first.id, "--note", "纯红画面");

    fs.writeFileSync(path.join(runDir, "facts.draft.json"), JSON.stringify({
      type: "测试类型",
      topic: "红蓝/演示",
      status: "complete",
      sections: [{ start: 0, end: 6, title: "全片", fact_ids: ["FACT-0001"] }],
      facts: [{ id: "FACT-0001", kind: "visual", text: "画面是纯红色", start: first.t, end: first.t, evidence: [first.id] }],
    }));
    assert.equal(json("check", runDir).status, "complete");

    const unrouted = relay("publish", runDir);
    assert.equal(unrouted.status, 3);
    assert.equal(JSON.parse(unrouted.stdout).status, "need_route");

    json("route", "set", "测试类型", "--workspace", path.join(tmp, "ws"));
    const published = json("publish", runDir);
    assert.match(path.basename(published.dir), /^\d{4}-\d{2}-\d{2}-红蓝-演示$/);
    assert.ok(fs.existsSync(path.join(published.dir, "facts.md")));
    assert.ok(fs.existsSync(path.join(published.dir, "产出")));
    assert.ok(!fs.existsSync(runDir));

    const again = json("init", video);
    assert.equal(again.status, "exists");
    assert.equal(again.dir, published.dir);

    const moved = path.join(tmp, "搬家.mp4");
    fs.renameSync(video, moved);
    assert.equal(json("init", moved).status, "exists");
    assert.equal(JSON.parse(fs.readFileSync(path.join(published.dir, "facts.json"), "utf8")).video.local_path, moved);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
