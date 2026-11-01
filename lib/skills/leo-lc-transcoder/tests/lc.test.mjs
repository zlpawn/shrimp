import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../scripts/lc.mjs";
import { parseArgs } from "../scripts/lib/args.mjs";
import { freePort, freshHome } from "./helpers.mjs";

const LC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lc.mjs");

function fakeSite({ authFailures = 0, question } = {}) {
  const state = { logins: 0, searched: [], failuresLeft: authFailures };
  const site = {
    login: async () => {
      state.logins++;
      return { LEETCODE_SESSION: `s${state.logins}`, csrftoken: "c" };
    },
    createApi: (creds) => ({
      whoami: async () => ({ signedIn: true, username: "tester" }),
      search: async (keyword) => {
        if (state.failuresLeft-- > 0) throw Object.assign(new Error("expired"), { code: "auth" });
        state.searched.push(keyword);
        return [{ id: "1", slug: "two-sum", session: creds.LEETCODE_SESSION }];
      },
      show: async () => question,
    }),
  };
  return { site, state };
}

const seedCredentials = (home) =>
  fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ LEETCODE_SESSION: "old", csrftoken: "c" }));

test("parseArgs 区分位置参数和 --选项", () => {
  assert.deepEqual(parseArgs(["show", "3", "--save-images", "/a", "--verbose"]), {
    pos: ["show", "3"],
    opts: { "save-images": "/a", verbose: true },
  });
});

test("没有登录态时先登录、校验并保存 cookie，再执行命令", async () => {
  const home = freshHome();
  const { site, state } = fakeSite();
  const r = await main(["search", "two", "sum"], { loadSiteImpl: async () => site });
  assert.equal(r.ok, true);
  assert.equal(state.logins, 1);
  assert.deepEqual(state.searched, ["two sum"]);
  const saved = JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));
  assert.equal(saved.LEETCODE_SESSION, "s1");
});

test("登录态失效时自动重新登录一次再重试", async () => {
  const home = freshHome();
  seedCredentials(home);
  const { site, state } = fakeSite({ authFailures: 1 });
  const r = await main(["search", "1"], { loadSiteImpl: async () => site });
  assert.equal(r.ok, true);
  assert.equal(state.logins, 1);
  assert.equal(r.data[0].session, "s1");
});

test("重新登录后仍然失效就报错，不无限重试", async () => {
  const home = freshHome();
  seedCredentials(home);
  const { site, state } = fakeSite({ authFailures: 5 });
  const r = await main(["search", "1"], { loadSiteImpl: async () => site });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "auth");
  assert.equal(state.logins, 1);
});

test("config set 写入配置，config 读出", async () => {
  freshHome();
  assert.equal((await main(["config"])).data.exists, false);
  await main(["config", "set", "vault_root=/tmp/v", "display_lang=en"]);
  const r = await main(["config"]);
  assert.equal(r.data.exists, true);
  assert.equal(r.data.config.vault_root, "/tmp/v");
  assert.equal(r.data.config.display_lang, "en");
});

test("未知命令和缺参数时返回用法", async () => {
  freshHome();
  const { site } = fakeSite();
  assert.equal((await main(["nope"], { loadSiteImpl: async () => site })).error.code, "usage");
  assert.equal((await main(["search"], { loadSiteImpl: async () => site })).error.code, "usage");
});

test("show --save-images 把题面图片下载到指定目录", async () => {
  const home = freshHome();
  seedCredentials(home);
  const question = { id: "206", images: ["https://assets.leetcode.com/uploads/2021/02/19/rev1ex1.jpg"] };
  const { site } = fakeSite({ question });
  const dir = path.join(home, "assets");
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("img").buffer });
  const r = await main(["show", "206", "--save-images", dir], { loadSiteImpl: async () => site, fetchImpl });
  const file = path.join(dir, "LC0206-rev1ex1.jpg");
  assert.deepEqual(r.data.savedImages, [{ url: question.images[0], file }]);
  assert.equal(fs.readFileSync(file, "utf8"), "img");
});

test("login 等不到扩展时进程按时退出，不挂着", async () => {
  const home = freshHome();
  const port = await freePort();
  const started = Date.now();
  const r = spawnSync(process.execPath, [LC, "login"], {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, LC_TRANSCODER_HOME: home, LC_BRIDGE_PORT: String(port), LC_LOGIN_TIMEOUT_MS: "300" },
  });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).error.code, "extension_timeout");
  assert.ok(Date.now() - started < 8000);
});
