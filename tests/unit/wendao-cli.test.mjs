import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveSecretPaths,
  readToken,
  saveToken,
  queryWendao,
} from "../../clis/wendao/wendao.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wendaoDir = path.join(projectRoot, "clis", "wendao");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wendao-cli-test-"));
}

test("wendao in-repo CLI is discoverable as a Node CLI", async () => {
  const { scanInRepoClis } = await import("../../lib/cli-core/discovery.mjs");
  const cli = scanInRepoClis(projectRoot).find((item) => item.name === "wendao");

  assert.ok(cli, "scanInRepoClis must discover wendao");
  assert.equal(cli.lang, "node");
  assert.equal(cli.command, "node");
  assert.equal(cli.args[0], "./clis/wendao/index.mjs");
  assert.match(cli.description, /携程问道/u);
});

test("resolveSecretPaths keeps secrets beside the stable Shrimp home", () => {
  const home = tempHome();
  try {
    const paths = resolveSecretPaths({ homeDir: home, env: {} });

    assert.equal(paths.root, path.join(home, ".shrimp", "secrets", "wendao"));
    assert.equal(paths.token, path.join(paths.root, "token"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("resolveSecretPaths allows an explicit secrets override and data-dir pointer", () => {
  const home = tempHome();
  const pointerHome = tempHome();
  try {
    const overridden = resolveSecretPaths({
      homeDir: home,
      env: { SHRIMP_SECRETS_DIR: path.join(home, "secure-shrimp") },
    });
    assert.equal(overridden.root, path.join(home, "secure-shrimp", "wendao"));

    const dataDir = path.join(pointerHome, "migrated");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(home, ".shrimp"), { recursive: true });
    fs.writeFileSync(path.join(home, ".shrimp", "data-dir.json"), JSON.stringify({ dataDir }), "utf8");
    const migrated = resolveSecretPaths({ homeDir: home, env: {} });
    assert.equal(migrated.root, path.join(home, ".shrimp", "secrets", "wendao"));
    assert.notEqual(migrated.root, path.join(dataDir, "secrets", "wendao"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pointerHome, { recursive: true, force: true });
  }
});

test("saveToken validates, stores, and restricts the token without echoing it", () => {
  const home = tempHome();
  try {
    const token = "0123456789abcdef0123456789abcdef";
    saveToken(token, { homeDir: home, env: {} });

    const root = path.join(home, ".shrimp", "secrets", "wendao");
    const tokenPath = path.join(root, "token");
    assert.equal(fs.readFileSync(tokenPath, "utf8"), token + "\n");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.join(home, ".shrimp", "secrets")).mode & 0o777, 0o700);
      assert.equal(fs.statSync(root).mode & 0o777, 0o700);
      assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    }
    assert.equal(readToken({ homeDir: home, env: {} }), token);

    assert.throws(() => saveToken("not-a-token", { homeDir: home, env: {} }), /32.*hex/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("readToken prefers environment credentials over the stable file", () => {
  const home = tempHome();
  try {
    const token = "0123456789abcdef0123456789abcdef";
    saveToken(token, { homeDir: home, env: {} });

    assert.equal(readToken({ homeDir: home, env: { WENDAO_API_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(readToken({ homeDir: home, env: { WENDAO_API_KEY: " " } }), token);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("queryWendao posts the exact query and retries short acknowledgements", async () => {
  const calls = [];
  let result = "好的。已为您规划好此次行程。";
  const query = await queryWendao("国庆去成都怎么玩", {
    token: "0123456789abcdef0123456789abcdef",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      result = calls.length === 1
        ? result
        : "## 成都国庆行程\n\n这是一个足够长的完整行程结果，包含景点、交通和美食建议。";
      return {
        ok: true,
        status: 200,
        json: async () => ({ result, error: null }),
      };
    },
    delay: () => {},
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://externalcallback.ctrip.com/skills/api/crew/qclaw/searchInfo");
  assert.deepEqual(calls[0].body, {
    inputs: {
      token: "0123456789abcdef0123456789abcdef",
      query: "国庆去成都怎么玩",
    },
  });
  assert.match(query, /^## 成都国庆行程/u);
});

test("queryWendao never leaks response state in API errors", async () => {
  await assert.rejects(
    () => queryWendao("北京一日游", {
      token: "0123456789abcdef0123456789abcdef",
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ state: { token: "0123456789abcdef0123456789abcdef" } }),
      }),
      delay: () => {},
    }),
    (error) => {
      assert.equal(error.message, "Wendao API returned HTTP 500.");
      assert.equal(error.message.includes("0123456789abcdef"), false);
      return true;
    },
  );
});

test("wendao SKILL.md instructs agents to use the CLI without reading the token", () => {
  const skill = fs.readFileSync(
    path.join(projectRoot, "lib", "skills", "leo-xiecheng-wendao", "SKILL.md"),
    "utf8",
  );
  assert.match(skill, /^---\nname: leo-xiecheng-wendao\n/u);
  assert.match(skill, /wendao "用户的完整问题原文"/u);
  assert.match(skill, /60 秒/u);
  assert.match(skill, /永远不要.*token/u);
  assert.doesNotMatch(skill, /cat .*token|open .*token/u);
});

test("leo-xiecheng-wendao is a managed skill and installs from the skill library", async () => {
  const { SkillInstaller } = await import("../../lib/session-sync/skill-installer.mjs");
  const managed = SkillInstaller.getManagedSkill("leo-xiecheng-wendao");
  assert.ok(managed, "leo-xiecheng-wendao must be listed in managed-catalog.json");
  assert.equal(managed.title, "携程问道旅行查询");
  assert.equal(managed.category, "research");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wendao-skill-test-"));
  try {
    const installed = SkillInstaller.installBaseSkill(tempDir, "leo-xiecheng-wendao");
    assert.equal(fs.existsSync(installed), true);
    const content = fs.readFileSync(installed, "utf8");
    assert.match(content, /^---\nname: leo-xiecheng-wendao\n/u);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("wendao CLI help documents the safe token entrypoint", async () => {
  const { promisify } = await import("node:util");
  const childProcess = await import("node:child_process");
  const execFileAsync = promisify(childProcess.execFile);

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(wendaoDir, "index.mjs"),
    "--help",
  ]);
  assert.match(stdout, /wendao login \[--stdin\]/u);
  assert.match(stdout, /never accepted as a command-line argument/u);
});

test("wendao CLI no-argument invocation fails with usage only", async () => {
  const { promisify } = await import("node:util");
  const childProcess = await import("node:child_process");
  const execFileAsync = promisify(childProcess.execFile);

  await assert.rejects(
    execFileAsync(process.execPath, [path.join(wendaoDir, "index.mjs")]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Usage:/u);
      return true;
    },
  );
});

test("wendao CLI login --stdin writes restricted credentials", async () => {
  const { spawn } = await import("node:child_process");
  const home = tempHome();
  const env = { ...process.env, HOME: home, WENDAO_API_KEY: "", SHRIMP_SECRETS_DIR: "" };
  const tokenPath = path.join(home, ".shrimp", "secrets", "wendao", "token");

  try {
    const login = spawn(
      process.execPath,
      [path.join(wendaoDir, "index.mjs"), "login", "--stdin"],
      { env },
    );
    login.stdin.end("0123456789abcdef0123456789abcdef\n");
    await waitForExit(login);
    assert.equal(fs.readFileSync(tokenPath, "utf8"), "0123456789abcdef0123456789abcdef\n");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.dirname(tokenPath)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    }

  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("wendao CLI flushes a large piped result before exiting", async () => {
  const { spawn } = await import("node:child_process");
  const preload = path.join(tempHome(), "wendao-fetch-mock.mjs");
  fs.mkdirSync(path.dirname(preload), { recursive: true });
  fs.writeFileSync(preload, [
    "const result = 'x'.repeat(1024 * 1024);",
    "globalThis.fetch = async () => ({",
    "  ok: true,",
    "  json: async () => ({ result, error: null }),",
    "});",
    "",
  ].join("\n"), "utf8");

  try {
    const child = spawn(
      process.execPath,
      ["--import", `file://${preload}`, path.join(wendaoDir, "index.mjs"), "大结果测试"],
      {
        env: { ...process.env, WENDAO_API_KEY: "0123456789abcdef0123456789abcdef" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(stdout.length, 1024 * 1024 + 1);
    assert.equal(stdout.at(-1), "\n");
  } finally {
    fs.rmSync(path.dirname(preload), { recursive: true, force: true });
  }
});

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(stderr || "Process exited with code " + code);
      error.code = code;
      error.stderr = stderr;
      reject(error);
    });
  });
}
