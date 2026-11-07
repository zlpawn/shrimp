import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendMissingTags } from "../recipes/lib/recipe-runner.mjs";
import { startFakeExtension } from "./fake-extension.mjs";

const RECIPES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../recipes");
const PNG = Buffer.from("png").toString("base64");

/** Defaults to a page where every element exists and uploads have finished. */
function fakePage({ evalResult = () => true, tabs = [], text = "上传完成", url = "", screenshot = PNG, fail = {} } = {}) {
  return (cmd) => {
    if (fail[cmd.type]) throw { code: "tab_outside_task", message: `${cmd.type} refused` };
    if (cmd.type === "tabs.list") return tabs;
    if (cmd.type === "page.eval") return { evalResult: evalResult(cmd.params.script) };
    if (cmd.type === "dom.content") return { text, url };
    if (cmd.type === "cdp.screenshot") return { data: screenshot };
    return {};
  };
}

async function runRecipe(name, args, page) {
  const fake = await startFakeExtension(page);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-recipe-"));
  const media = path.join(dir, "media.png");
  fs.writeFileSync(media, "x");
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(
        "node",
        [path.join(RECIPES, name), ...args.map((a) => (a === "MEDIA" ? media : a)), "--out", path.join(dir, "shot.png")],
        { env: { ...process.env, LEO_LANTERN_PORT: String(fake.port) } }
      );
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      child.on("exit", (code) => resolve({ code, out }));
    });
    const scripts = fake.commands.filter((c) => c.type === "page.eval").map((c) => c.params.script);
    return { ...result, commands: fake.commands, types: fake.commands.map((c) => c.type), scripts, media };
  } finally {
    await fake.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BILI = ["--video", "MEDIA", "--title", "标题"];
const XHS = ["--images", "MEDIA", "--title", "标题", "--content", "正文"];
const DOUYIN = ["--video", "MEDIA", "--title", "标题"];
const submitted = (scripts, label) => scripts.some((s) => s.includes(label));

describe("publish recipes", { concurrency: true }, () => {
  test("bilibili: a malformed schedule stops before touching the browser", async () => {
    const r = await runRecipe("bilibili-publish.mjs", [...BILI, "--schedule", "明天下午", "--publish"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.commands, []);
  });

  test("bilibili: too many tags stop before touching the browser", async () => {
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`).join(",");
    const r = await runRecipe("bilibili-publish.mjs", [...BILI, "--tags", tags]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.commands, []);
  });

  test("bilibili: an unfinished upload never reaches submit", async () => {
    const r = await runRecipe(
      "bilibili-publish.mjs",
      [...BILI, "--publish", "--upload-timeout-sec", "0"],
      fakePage({ text: "上传中 37%" })
    );
    assert.equal(r.code, 1);
    assert.equal(submitted(r.scripts, "立即投稿"), false);
  });

  test("bilibili: a missing title input aborts instead of publishing", async () => {
    const r = await runRecipe("bilibili-publish.mjs", [...BILI, "--publish"], fakePage({ evalResult: () => null }));
    assert.equal(r.code, 1);
    assert.equal(submitted(r.scripts, "立即投稿"), false);
    assert.match(r.out, /标题/);
  });

  test("bilibili: a refused navigation stops before uploading anywhere", async () => {
    const r = await runRecipe("bilibili-publish.mjs", BILI, fakePage({ fail: { "tabs.goto": true } }));
    assert.equal(r.code, 1);
    assert.equal(r.types.includes("cdp.upload"), false);
  });

  test("bilibili: a failed screenshot is not reported as saved", async () => {
    const r = await runRecipe("bilibili-publish.mjs", BILI, fakePage({ screenshot: "" }));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /已落盘/);
    assert.match(r.out, /截图/);
  });

  test("bilibili: publishes by default", async () => {
    const r = await runRecipe("bilibili-publish.mjs", BILI, fakePage());
    assert.equal(r.code, 0, r.out);
    assert.equal(submitted(r.scripts, "立即投稿"), true);
  });

  test("bilibili: --dry-run stops before submit", async () => {
    const r = await runRecipe("bilibili-publish.mjs", [...BILI, "--dry-run"], fakePage());
    assert.equal(r.code, 0, r.out);
    assert.equal(submitted(r.scripts, "立即投稿"), false);
  });

  test("douyin: publishes by default", async () => {
    const r = await runRecipe("douyin-publish.mjs", DOUYIN, fakePage({ text: "作品描述 发布成功" }));
    assert.equal(r.code, 0, r.out);
    assert.equal(submitted(r.scripts, "button-dhlUZE"), true);
    assert.match(r.out, /🎉/);
  });

  test("douyin: --dry-run stops before submit", async () => {
    const r = await runRecipe("douyin-publish.mjs", [...DOUYIN, "--dry-run"], fakePage({ text: "作品描述" }));
    assert.equal(r.code, 0, r.out);
    assert.equal(submitted(r.scripts, "button-dhlUZE"), false);
  });

  test("xhs: a missing publish button is a failure, not a success", async () => {
    const r = await runRecipe(
      "xhs-publish.mjs",
      XHS,
      fakePage({ evalResult: (s) => (s.includes("xhs-publish-btn") ? false : true) })
    );
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.out, /🎉/);
  });

  test("xhs: a malformed schedule stops before touching the browser", async () => {
    const r = await runRecipe("xhs-publish.mjs", [...XHS, "--schedule", "tomorrow"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.commands, []);
  });

  test("xhs: a clicked publish button is reported as clicked, not as published", async () => {
    const r = await runRecipe("xhs-publish.mjs", XHS, fakePage());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /🎉/);
    assert.match(r.out, /已点击/);
  });

  test("douyin: an already open form tab still uploads the requested video", async () => {
    const tab = { id: 7, url: "https://creator.douyin.com/creator-micro/content/post/video" };
    const r = await runRecipe("douyin-publish.mjs", [...DOUYIN, "--dry-run"], fakePage({ tabs: [tab], text: "作品描述" }));
    assert.equal(r.code, 0, r.out);
    const upload = r.commands.find((c) => c.type === "cdp.upload");
    assert.deepEqual(upload?.params.files, [r.media]);
  });

  test("douyin: --reuse-form keeps the open form and skips the upload", async () => {
    const tab = { id: 7, url: "https://creator.douyin.com/creator-micro/content/post/video" };
    const r = await runRecipe("douyin-publish.mjs", [...DOUYIN, "--reuse-form", "--dry-run"], fakePage({ tabs: [tab], text: "作品描述" }));
    assert.equal(r.code, 0, r.out);
    assert.equal(r.types.includes("cdp.upload"), false);
  });

  test("douyin: a missing cover file stops before touching the browser", async () => {
    const r = await runRecipe("douyin-publish.mjs", [...DOUYIN, "--cover", "/no/such/cover.png"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.commands, []);
  });

  test("douyin: an unconfirmed publish exits non-zero", async () => {
    const r = await runRecipe("douyin-publish.mjs", [...DOUYIN, "--publish"], fakePage({ text: "作品描述" }));
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /🎉/);
  });
});

test("appendMissingTags adds each absent tag and keeps present ones once", () => {
  assert.equal(appendMissingTags("", ["AI", "#视频"]), "#AI #视频");
  assert.equal(appendMissingTags("讲讲 AI 工具", ["AI", "视频"]), "讲讲 AI 工具 #AI #视频");
  assert.equal(appendMissingTags("讲讲 #AI 工具", ["AI", "视频"]), "讲讲 #AI 工具 #视频");
});
