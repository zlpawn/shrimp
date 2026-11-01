import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  configExists,
  readConfig,
  writeConfig,
  readCredentials,
  writeCredentials,
} from "../scripts/lib/config.mjs";

function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-home-"));
  process.env.LC_TRANSCODER_HOME = dir;
  return dir;
}

test("没有配置文件时返回默认配置", () => {
  freshHome();
  assert.equal(configExists(), false);
  assert.deepEqual(readConfig(), DEFAULT_CONFIG);
  assert.equal(readCredentials(), null);
});

test("writeConfig 合并已有配置并记录 updated_at", () => {
  freshHome();
  writeConfig({ vault_root: "/v" });
  const next = writeConfig({ display_lang: "en" });
  assert.equal(configExists(), true);
  assert.equal(next.vault_root, "/v");
  assert.equal(next.display_lang, "en");
  assert.equal(next.site, "leetcode-com");
  assert.match(next.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(readConfig(), next);
});

test("writeCredentials 写入 fetched_at，文件权限为 600", () => {
  const home = freshHome();
  writeCredentials({ LEETCODE_SESSION: "s", csrftoken: "c" });
  const saved = readCredentials();
  assert.equal(saved.LEETCODE_SESSION, "s");
  assert.equal(saved.csrftoken, "c");
  assert.match(saved.fetched_at, /^\d{4}-/);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(home, "credentials.json")).mode & 0o777, 0o600);
  }
});
