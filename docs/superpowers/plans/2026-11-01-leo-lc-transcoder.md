# leo-lc-transcoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `leo-lc-transcoder` skill：用"解题四问 + 题型模板"教会算法薄弱的用户做 LeetCode 题、沉淀可举一反三的通用框架，脚本直连 leetcode.com（搜题 / 看题 / 运行 / 提交 / 高票题解），生成可单步播放的算法动画，学习成果沉淀到 Obsidian 并按间隔复习，目标是通过严格的算法面试。

**Architecture:** skill 位于 `lib/skills/leo-lc-transcoder/`。`scripts/lc.mjs` 是统一入口，按 `config.site` 加载 `scripts/sites/<site>/` 下的 `api.mjs`（接口封装）和 `cookie.mjs`（登录态）。cookie 通过 Chrome 上已安装的 `Leo cookie.txt Locally` 扩展获取：19527 上已有桥接服务就借用，没有就临时扮演桥接服务，拿到即退出。`scripts/viz.mjs` 把 `assets/T.java` 追加到 Java 演示程序末尾运行，收集轨迹帧并嵌入 `assets/player.html`，生成离线可用的单个 HTML。教学流程、卡片格式和题型目录写在 `SKILL.md` 与 `references/` 中。

**Tech Stack:** Node.js 20+（只用内置 `fetch` / `http` / `node:test`，零 npm 依赖）、JDK 11+（单文件源码启动 `java Demo.java`）、原生 HTML/CSS/JS 播放器、Obsidian Markdown + Bases。

**Spec:** `docs/superpowers/specs/2026-11-01-leo-lc-transcoder-design.md`

## Global Constraints

- 运行时只依赖 Node.js 20+ 内置能力和本机 JDK；不依赖 ego-browser、lantern CLI 或任何 npm 包。
- 跨平台：macOS 与 Windows 都能运行（路径用 `path.join`，java 可执行文件在 Windows 上是 `java.exe`）。
- 站点只支持 leetcode.com，代码隔离在 `scripts/sites/leetcode-com/`；新增站点 = 新增同级目录。
- 用户级目录：`~/.shrimp/skills/leo-lc-transcoder/`（`config.json`、`credentials.json`）；测试用环境变量 `LC_TRANSCODER_HOME` 覆盖。
- `credentials.json` 权限 600，只存 `LEETCODE_SESSION`、`csrftoken`、`fetched_at`；任何输出都不打印 cookie 值。
- cookie 脚本拿到结果或超时后必须关闭 server 并退出，不能挂着。
- 所有脚本输出 JSON：成功 `{ "ok": true, "data": ... }`，失败 `{ "ok": false, "error": { "code", "message" } }` 并以退出码 1 结束。
- 讲解、模板、提交统一用 Java；显示语言默认 `zh`。
- 知识库：`/Users/pa/project/OBDI/bg/nightmare/LC-Agent-Wiki`（写在 config 的 `vault_root`），遵守 vault 根目录 `SCHEMA.md`。
- 限时：Easy 10 分钟，Medium / Hard 15 分钟；面试可用 = 掌握度 4 级。
- 所有文件 UTF-8 编码。
- 在分支 `feat/leo-lc-transcoder` 上工作，每个任务结束提交一次；提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。

## 已用浏览器抓包确认的 leetcode.com 接口（2026-11-01）

| 用途 | 请求 | 关键点 |
|---|---|---|
| 当前用户 | `POST /graphql/` `userStatus { isSignedIn username }` | 未登录返回 `isSignedIn: false`（HTTP 200） |
| 搜题 | `POST /graphql/` `problemsetQuestionListV2(searchKeyword, limit, skip, categorySlug: "all-code-essentials", filters: {filterCombineType: "ALL"}, sortBy: {sortField: "CUSTOM", sortOrder: "ASCENDING"})` | 关键词和题号都能搜；`difficulty` 为 `EASY`，`status` 为 `SOLVED` |
| 题目详情 | `POST /graphql/` `question(titleSlug)` | `content` 为 HTML，图片是 `assets.leetcode.com` 的 `<img src>`；`metaData` 是 JSON 字符串；`exampleTestcaseList` 是数组；`difficulty` 为 `Hard` |
| 运行 | `POST /problems/{slug}/interpret_solution/` `{lang, question_id, typed_code, data_input}` | 返回 `interpret_id` |
| 提交 | `POST /problems/{slug}/submit/` `{lang, question_id, typed_code}` | 返回 `submission_id` |
| 判题结果 | `GET /submissions/detail/{id}/check/` | 轮询直到 `state === "SUCCESS"`。**运行答案错误时 `status_msg` 仍是 `"Accepted"`，要看 `correct_answer`** |
| 题解列表 | `POST /graphql/` `ugcArticleSolutionArticles(questionSlug, orderBy: MOST_VOTES, tagSlugs: ["java"], first, skip, userInput: "", searchScope: CONTENT)` | 点赞数在 `reactions[reactionType=UPVOTE].count` |
| 题解正文 | `POST /graphql/` `ugcArticleSolutionArticle(topicId) { content }` | **正文里的换行是转义后的字面量 `\n`，要按 JSON 字符串解码**；代码块围栏为 ```` ```Java [] ```` |

请求头：`cookie: LEETCODE_SESSION=…; csrftoken=…`、`x-csrftoken`、`origin: https://leetcode.com`、`referer`、`user-agent`。不带登录态时 `interpret_solution` 返回 403（Cloudflare 页面）；连续两次运行间隔太短会返回 HTML 页面，需要等待后重试。

---

## File Structure

```
lib/skills/leo-lc-transcoder/
├── SKILL.md                         # Task 7：教学流程与协议
├── package.json                     # Task 1
├── references/
│   ├── pattern-catalog.md           # Task 6：数据规模对照表 + 13 个题型的信号 / 模板 / 模板题
│   ├── teaching-examples.md         # Task 6：讲题示范
│   └── card-templates.md            # Task 6：知识库初始化、题型卡、单题卡格式
├── assets/
│   ├── T.java                       # Task 5：轨迹记录器
│   └── player.html                  # Task 5：动画播放器模板
├── scripts/
│   ├── lc.mjs                       # Task 4：统一入口
│   ├── viz.mjs                      # Task 5：生成动画
│   ├── lib/
│   │   ├── config.mjs               # Task 1：配置与登录态读写
│   │   └── args.mjs                 # Task 4：命令行参数解析
│   └── sites/leetcode-com/
│       ├── cookie.mjs               # Task 2
│       └── api.mjs                  # Task 3
└── tests/
    ├── helpers.mjs                  # Task 2：freePort / isListening / freshHome
    ├── config.test.mjs              # Task 1
    ├── cookie.test.mjs              # Task 2
    ├── fixtures.mjs                 # Task 3：抓包样本
    ├── api.test.mjs                 # Task 3
    ├── lc.test.mjs                  # Task 4
    ├── viz.test.mjs                 # Task 5
    └── skill-package.test.mjs       # Task 7
```

修改：`package.json`（根目录，Task 1 加测试脚本）、`lib/skills/managed-catalog.json`（Task 7 登记）。

---

### Task 1: skill 骨架与配置读写

**Files:**
- Create: `lib/skills/leo-lc-transcoder/package.json`
- Create: `lib/skills/leo-lc-transcoder/scripts/lib/config.mjs`
- Test: `lib/skills/leo-lc-transcoder/tests/config.test.mjs`
- Modify: `package.json`（根目录 `scripts` 中 `"test:leo-lantern"` 那一行之后）

**Interfaces:**
- Produces（`scripts/lib/config.mjs`）：
  - `DEFAULT_CONFIG = { site: "leetcode-com", display_lang: "zh", vault_root: null, java_home: null }`
  - `homeDir(): string` — `LC_TRANSCODER_HOME` 或 `~/.shrimp/skills/leo-lc-transcoder`
  - `configExists(): boolean`
  - `readConfig(): object` — 与 `DEFAULT_CONFIG` 合并
  - `writeConfig(patch: object): object` — 合并、写入 `updated_at`、返回新配置
  - `readCredentials(): { LEETCODE_SESSION, csrftoken, fetched_at } | null`
  - `writeCredentials(creds: object): void` — 追加 `fetched_at`，权限 600

- [ ] **Step 1: 建 skill 的 package.json 和根目录测试脚本**

`lib/skills/leo-lc-transcoder/package.json`：

```json
{
  "name": "leo-lc-transcoder",
  "version": "0.1.0",
  "description": "LeetCode 算法面试教练技能",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test --test-concurrency=1 tests/*.test.mjs"
  }
}
```

根目录 `package.json`，在 `"test:leo-lantern": ...` 这一行后面插入一行：

```json
    "test:leo-lc-transcoder": "node --test --test-concurrency=1 lib/skills/leo-lc-transcoder/tests/*.test.mjs",
```

- [ ] **Step 2: 写失败的测试**

`lib/skills/leo-lc-transcoder/tests/config.test.mjs`：

```js
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
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `node --test lib/skills/leo-lc-transcoder/tests/config.test.mjs`
Expected: FAIL，`Cannot find module .../scripts/lib/config.mjs`

- [ ] **Step 4: 实现 config.mjs**

`lib/skills/leo-lc-transcoder/scripts/lib/config.mjs`：

```js
// 用户级配置与登录态：~/.shrimp/skills/leo-lc-transcoder/（测试时用 LC_TRANSCODER_HOME 覆盖）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CONFIG = { site: "leetcode-com", display_lang: "zh", vault_root: null, java_home: null };

export function homeDir() {
  return process.env.LC_TRANSCODER_HOME || path.join(os.homedir(), ".shrimp", "skills", "leo-lc-transcoder");
}

const fileOf = (name) => path.join(homeDir(), name);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode });
  if (mode) fs.chmodSync(file, mode); // 文件已存在时 writeFileSync 不会改权限
}

export const configExists = () => fs.existsSync(fileOf("config.json"));

export const readConfig = () => ({ ...DEFAULT_CONFIG, ...readJson(fileOf("config.json")) });

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch, updated_at: new Date().toISOString() };
  writeJson(fileOf("config.json"), next);
  return next;
}

export const readCredentials = () => readJson(fileOf("credentials.json"));

export function writeCredentials(creds) {
  writeJson(fileOf("credentials.json"), { ...creds, fetched_at: new Date().toISOString() }, 0o600);
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test lib/skills/leo-lc-transcoder/tests/config.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 6: 提交**

```bash
git add package.json lib/skills/leo-lc-transcoder/package.json lib/skills/leo-lc-transcoder/scripts/lib/config.mjs lib/skills/leo-lc-transcoder/tests/config.test.mjs
git commit -m "feat(leo-lc-transcoder): add skill scaffold and config store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 通过浏览器扩展读取 cookie（cookie.mjs）

扩展协议（来自 `extensions/leo-cookie-txt-locally/background.js`）：扩展轮询 `http://127.0.0.1:19527` 的 `GET /ext/poll?waitMs=`（失败时退到 `POST /v1/extension-tasks/claim`），领到任务 `{ id, type, params }` 后执行，再 `POST /ext/result`（失败时退到 `POST /v1/extension-tasks/{id}/complete|fail`）回传 `{ id, ok, result, error }`。`cookies.export` 任务的结果是 `{ cookies, count }`。扩展离线时约每秒重试一次。lantern 桥接服务对外提供 `GET /health` 和 `POST /cmd { type, params, timeoutMs }`，返回 `{ ok, result }`。

**Files:**
- Create: `lib/skills/leo-lc-transcoder/scripts/sites/leetcode-com/cookie.mjs`
- Create: `lib/skills/leo-lc-transcoder/tests/helpers.mjs`
- Test: `lib/skills/leo-lc-transcoder/tests/cookie.test.mjs`

**Interfaces:**
- Produces（`cookie.mjs`）：
  - `BRIDGE_PORT = 19527`
  - `class CookieError extends Error { code }`，code 取值：`extension_timeout` / `extension_error` / `extension_unavailable` / `port_busy` / `not_logged_in`
  - `serveOnce(port: number, timeoutMs: number): Promise<Cookie[]>` — 临时桥接服务，完成或超时后关闭端口
  - `pickSession(cookies: Cookie[]): { LEETCODE_SESSION, csrftoken }`
  - `login({ port?, timeoutMs? }?): Promise<{ LEETCODE_SESSION, csrftoken }>` — 默认 `port = Number(process.env.LC_BRIDGE_PORT) || 19527`，`timeoutMs = Number(process.env.LC_LOGIN_TIMEOUT_MS) || 60000`
- Produces（`tests/helpers.mjs`）：`freePort(): Promise<number>`、`isListening(port): Promise<boolean>`、`freshHome(): string`（创建临时目录并设置 `LC_TRANSCODER_HOME`）

- [ ] **Step 1: 写测试辅助函数**

`lib/skills/leo-lc-transcoder/tests/helpers.mjs`：

```js
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-home-"));
  process.env.LC_TRANSCODER_HOME = dir;
  return dir;
}
```

- [ ] **Step 2: 写失败的测试**

`lib/skills/leo-lc-transcoder/tests/cookie.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { serveOnce, login, pickSession } from "../scripts/sites/leetcode-com/cookie.mjs";
import { freePort, isListening } from "./helpers.mjs";

const COOKIES = [
  { name: "csrftoken", value: "csrf-1", domain: "leetcode.com" },
  { name: "LEETCODE_SESSION", value: "sess-1", domain: ".leetcode.com" },
  { name: "_ga", value: "x", domain: ".leetcode.com" },
];
const SESSION = { LEETCODE_SESSION: "sess-1", csrftoken: "csrf-1" };

// 按扩展的真实协议模拟：轮询领任务，执行后回传结果
async function fakeExtension(port, reply) {
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ext/poll?waitMs=1000`);
      const { cmd } = await res.json();
      if (cmd) {
        await fetch(`http://127.0.0.1:${port}/ext/result`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: cmd.id, ...reply }),
        });
        return cmd;
      }
    } catch {
      // 临时桥接服务还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("fake extension never received a command");
}

test("没有桥接服务时临时扮演桥接服务，拿到 cookie 后关闭端口", async () => {
  const port = await freePort();
  const pending = login({ port, timeoutMs: 5000 });
  const cmd = await fakeExtension(port, { ok: true, result: { cookies: COOKIES, count: 3 } });
  assert.deepEqual(await pending, SESSION);
  assert.equal(cmd.type, "cookies.export");
  assert.deepEqual(cmd.params, { domain: "leetcode.com" });
  assert.equal(await isListening(port), false);
});

test("端口上已有桥接服务时借用它的 /cmd", async () => {
  const port = await freePort();
  let received;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") return res.end(JSON.stringify({ ok: true, bridge: true }));
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.end(JSON.stringify({ ok: true, result: { cookies: COOKIES, count: 3 } }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    assert.deepEqual(await login({ port, timeoutMs: 1000 }), SESSION);
    assert.equal(received.type, "cookies.export");
    assert.deepEqual(received.params, { domain: "leetcode.com" });
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test("等不到扩展时超时报错，并关闭端口", async () => {
  const port = await freePort();
  await assert.rejects(serveOnce(port, 200), { code: "extension_timeout" });
  assert.equal(await isListening(port), false);
});

test("端口被非桥接程序占用时报 port_busy", async () => {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    res.statusCode = 404;
    res.end("nope");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    await assert.rejects(login({ port, timeoutMs: 500 }), { code: "port_busy" });
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test("扩展执行失败时报 extension_error", async () => {
  const port = await freePort();
  const rejected = assert.rejects(serveOnce(port, 5000), { code: "extension_error" });
  await fakeExtension(port, { ok: false, error: { message: "boom" } });
  await rejected;
});

test("没有 LEETCODE_SESSION 时提示先在 Chrome 登录", () => {
  assert.throws(() => pickSession([{ name: "csrftoken", value: "c" }]), { code: "not_logged_in" });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `node --test lib/skills/leo-lc-transcoder/tests/cookie.test.mjs`
Expected: FAIL，`Cannot find module .../cookie.mjs`

- [ ] **Step 4: 实现 cookie.mjs**

`lib/skills/leo-lc-transcoder/scripts/sites/leetcode-com/cookie.mjs`：

```js
// 通过 Chrome 上的 Leo cookie.txt Locally 扩展读取 leetcode.com 的 cookie。
// 扩展协议（extensions/leo-cookie-txt-locally/background.js）：扩展轮询 127.0.0.1:19527 的
// GET /ext/poll 领取任务 {id, type, params}，执行后 POST /ext/result 回传 {id, ok, result}。
import http from "node:http";

export const BRIDGE_PORT = 19527;
const DOMAIN = "leetcode.com";

export class CookieError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 端口上已有 lantern 或网关的桥接服务时，让它转发任务；端口上没有桥接服务时返回 null
async function askExistingBridge(port, timeoutMs) {
  let health;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    health = await res.json();
  } catch {
    return null;
  }
  if (!health?.ok) return null;
  const res = await fetch(`http://127.0.0.1:${port}/cmd`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "cookies.export", params: { domain: DOMAIN }, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5000),
  });
  const body = await res.json();
  if (!body.ok) {
    throw new CookieError("extension_unavailable", body.error?.message || "桥接服务没能读取 cookie，请打开 Chrome 并确认扩展已启用");
  }
  return body.result?.cookies || [];
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// connection: close 让每个连接响应完就断开，server.close() 才能很快完成
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify(body));
}

// 临时扮演桥接服务：只派发一个 cookies.export 任务，拿到结果或超时后立即关闭端口
export function serveOnce(port, timeoutMs) {
  const cmd = { id: `lc_${Date.now()}`, type: "cookies.export", params: { domain: DOMAIN }, createdAt: Date.now() };
  let delivered = false;
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && pathname === "/health") {
        return send(res, 200, { ok: true, bridge: true, service: "leo-lc-transcoder-cookie" });
      }
      if (pathname === "/ext/hello" || pathname === "/ext/heartbeat") return send(res, 200, { ok: true });
      if (pathname === "/ext/poll" || pathname === "/v1/extension-tasks/claim") {
        const out = delivered ? null : cmd;
        delivered = true;
        return send(res, 200, { ok: true, cmd: out, tasks: out ? [out] : [] });
      }
      if (req.method === "POST" && (pathname === "/ext/result" || pathname.startsWith("/v1/extension-tasks/"))) {
        const body = await readBody(req);
        send(res, 200, { ok: true });
        const id = body.id || body.task_id || decodeURIComponent(pathname.split("/")[3] || "");
        if (id !== cmd.id) return;
        if (body.ok === false || body.error) {
          finish(new CookieError("extension_error", body.error?.message || "扩展读取 cookie 失败"));
        } else {
          finish(null, body.result?.cookies || body.cookies || []);
        }
        return;
      }
      send(res, 404, { ok: false });
    });

    const timer = setTimeout(
      () => finish(new CookieError("extension_timeout", `${Math.round(timeoutMs / 1000)} 秒内没有等到浏览器扩展，请打开 Chrome 并确认 Leo cookie.txt Locally 扩展已启用`)),
      timeoutMs,
    );

    // 等端口真正关闭后再返回结果，保证调用方拿到结果时进程里没有残留的监听
    function finish(err, cookies) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => (err ? reject(err) : resolve(cookies)));
      server.closeIdleConnections();
    }

    server.on("error", (err) => {
      finish(err.code === "EADDRINUSE" ? new CookieError("port_busy", `端口 ${port} 被其他程序占用，且它不是桥接服务`) : err);
    });
    server.listen(port, "127.0.0.1");
  });
}

export function pickSession(cookies) {
  const get = (name) => cookies.find((c) => c.name === name)?.value;
  const session = get("LEETCODE_SESSION");
  const csrftoken = get("csrftoken");
  if (!session || !csrftoken) {
    throw new CookieError("not_logged_in", "Chrome 里没有 leetcode.com 的登录态，请先在 Chrome 登录 leetcode.com");
  }
  return { LEETCODE_SESSION: session, csrftoken };
}

export async function login({
  port = Number(process.env.LC_BRIDGE_PORT) || BRIDGE_PORT,
  timeoutMs = Number(process.env.LC_LOGIN_TIMEOUT_MS) || 60000,
} = {}) {
  const cookies = (await askExistingBridge(port, timeoutMs)) ?? (await serveOnce(port, timeoutMs));
  return pickSession(cookies);
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test --test-concurrency=1 lib/skills/leo-lc-transcoder/tests/cookie.test.mjs`
Expected: PASS（6 tests），进程在几秒内结束（没有挂着的端口）

- [ ] **Step 6: 提交**

```bash
git add lib/skills/leo-lc-transcoder/scripts/sites/leetcode-com/cookie.mjs lib/skills/leo-lc-transcoder/tests/helpers.mjs lib/skills/leo-lc-transcoder/tests/cookie.test.mjs
git commit -m "feat(leo-lc-transcoder): read leetcode cookies via the browser extension" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: leetcode.com 接口封装（api.mjs）

**Files:**
- Create: `lib/skills/leo-lc-transcoder/scripts/sites/leetcode-com/api.mjs`
- Create: `lib/skills/leo-lc-transcoder/tests/fixtures.mjs`
- Test: `lib/skills/leo-lc-transcoder/tests/api.test.mjs`

**Interfaces:**
- Produces（`api.mjs`）：
  - `class LcError extends Error { code, detail }`，code 取值：`auth` / `rate_limited` / `bad_response` / `graphql` / `not_found` / `paid_only` / `judge_timeout`
  - `parseSearch(body) → Array<{ id, title, slug, difficulty, paidOnly, status, tags: string[] }>`
  - `parseQuestion(question) → { id, questionId, title, slug, url, difficulty, status, tags, contentHtml, images: string[], exampleTestcases: string[], metaData: object, javaTemplate: string|null, hints: string[] }`
  - `parseJudge(raw, kind: "run"|"submit")`：
    - run → `{ kind, status, passed, output: string[], expected: string[], stdout: string[], compileError, runtimeError, runtime, memory }`
    - submit → `{ kind, status, passed, submissionId, totalCorrect, totalTestcases, lastTestcase, output, expected, stdout, compileError, runtimeError, runtime, memory, runtimePercentile, memoryPercentile }`
  - `decodeContent(raw: string): string`、`javaBlocks(markdown: string): string[]`
  - `createApi(creds: { LEETCODE_SESSION, csrftoken }, deps?: { fetchImpl, sleep, pollMs = 1500, maxPolls = 40 })` 返回：
    - `whoami(): Promise<{ signedIn, username }>`
    - `search(keyword, limit = 10)`
    - `show(idOrSlug)` → parseQuestion 结果
    - `run(idOrSlug, code, input?)` — `input` 缺省时用示例用例按 `\n` 拼接
    - `submit(idOrSlug, code)`
    - `solutions(idOrSlug, top = 5) → Array<{ title, author, upvotes, topicId, url, content, javaCode: string[] }>`

- [ ] **Step 1: 写抓包样本**

`lib/skills/leo-lc-transcoder/tests/fixtures.mjs`：

```js
// 2026-11-01 用浏览器抓取的 leetcode.com 真实响应，删去了与解析无关的字段。

export const SEARCH_3 = {
  data: {
    problemsetQuestionListV2: {
      questions: [
        {
          questionFrontendId: "3",
          title: "Longest Substring Without Repeating Characters",
          titleSlug: "longest-substring-without-repeating-characters",
          difficulty: "MEDIUM",
          paidOnly: false,
          status: "SOLVED",
          topicTags: [
            { name: "Hash Table", slug: "hash-table" },
            { name: "String", slug: "string" },
            { name: "Sliding Window", slug: "sliding-window" },
          ],
        },
        {
          questionFrontendId: "30",
          title: "Substring with Concatenation of All Words",
          titleSlug: "substring-with-concatenation-of-all-words",
          difficulty: "HARD",
          paidOnly: false,
          status: null,
          topicTags: [{ name: "Sliding Window", slug: "sliding-window" }],
        },
      ],
    },
  },
};

// 搜 "206" 时，2060 排在 206 前面，用来测试按题号精确匹配
export const SEARCH_206 = {
  data: {
    problemsetQuestionListV2: {
      questions: [
        { questionFrontendId: "2060", title: "Check if an Original String Exists Given Two Encoded Strings", titleSlug: "check-if-an-original-string-exists-given-two-encoded-strings", difficulty: "HARD", paidOnly: false, status: null, topicTags: [] },
        { questionFrontendId: "206", title: "Reverse Linked List", titleSlug: "reverse-linked-list", difficulty: "EASY", paidOnly: false, status: "SOLVED", topicTags: [{ name: "Linked List", slug: "linked-list" }, { name: "Recursion", slug: "recursion" }] },
      ],
    },
  },
};

export const QUESTION_206 = {
  data: {
    question: {
      questionId: "206",
      questionFrontendId: "206",
      title: "Reverse Linked List",
      titleSlug: "reverse-linked-list",
      content:
        '<p>Given the <code>head</code> of a singly linked list, reverse the list, and return <em>the reversed list</em>.</p>\n<p><strong class="example">Example 1:</strong></p>\n<img alt="" src="https://assets.leetcode.com/uploads/2021/02/19/rev1ex1.jpg" style="width: 542px; height: 222px;" />\n<pre><strong>Input:</strong> head = [1,2,3,4,5]\n<strong>Output:</strong> [5,4,3,2,1]</pre>\n<img alt="" src="https://assets.leetcode.com/uploads/2021/02/19/rev1ex2.jpg" style="width: 182px; height: 222px;" />',
      difficulty: "Easy",
      isPaidOnly: false,
      exampleTestcaseList: ["[1,2,3,4,5]", "[1,2]", "[]"],
      metaData: '{\n  "name": "reverseList",\n  "params": [\n    {\n      "name": "head",\n      "type": "ListNode"\n    }\n  ],\n  "return": {\n    "type": "ListNode"\n  }\n}',
      hints: [],
      status: "ac",
      topicTags: [
        { name: "Linked List", slug: "linked-list" },
        { name: "Recursion", slug: "recursion" },
      ],
      codeSnippets: [
        { langSlug: "cpp", code: "class Solution {\npublic:\n    ListNode* reverseList(ListNode* head) {\n        \n    }\n};" },
        { langSlug: "java", code: "class Solution {\n    public ListNode reverseList(ListNode head) {\n        \n    }\n}" },
      ],
    },
  },
};

export const QUESTION_PAID = {
  data: {
    question: {
      questionId: "1102",
      questionFrontendId: "1150",
      title: "Check If a Number Is Majority Element in a Sorted Array",
      titleSlug: "check-if-a-number-is-majority-element-in-a-sorted-array",
      content: null,
      difficulty: "Easy",
      isPaidOnly: true,
      exampleTestcaseList: [],
      metaData: "{}",
      hints: [],
      status: null,
      topicTags: [],
      codeSnippets: null,
    },
  },
};

export const ME_OK = { data: { userStatus: { isSignedIn: true, username: "tester" } } };

export const INTERPRET = { interpret_id: "runcode_1793538465.3095_TtOXjX5wV1", test_case: "[3,2,4]\n6" };

export const CHECK_PENDING = { state: "PENDING" };

export const CHECK_RUN_OK = {
  status_code: 10, lang: "java", run_success: true, status_runtime: "0 ms", memory: 42024000,
  code_answer: ["[0,1]", "[1,2]", ""], code_output: [], std_output_list: ["", "", ""],
  expected_code_answer: ["[0,1]", "[1,2]", ""], correct_answer: true, compare_result: "11",
  total_correct: 2, total_testcases: 2, status_memory: "42 MB", pretty_lang: "Java",
  submission_id: "runcode_1793538439.691717_I11GXGp3IW", status_msg: "Accepted", state: "SUCCESS",
};

// 注意：答案错误时 status_msg 仍是 "Accepted"，correct_answer 为 false
export const CHECK_RUN_WRONG = {
  status_code: 10, lang: "java", run_success: true, status_runtime: "0 ms", memory: 41224000,
  code_answer: ["[0,1]", ""], code_output: [], std_output_list: ["", ""],
  expected_code_answer: ["[1,2]", ""], correct_answer: false, compare_result: "0",
  total_correct: 0, total_testcases: 1, status_memory: "41.2 MB", pretty_lang: "Java",
  submission_id: "runcode_1793538465.3095_TtOXjX5wV1", status_msg: "Accepted", state: "SUCCESS",
};

export const CHECK_RUN_COMPILE_ERROR = {
  status_code: 20, lang: "java", run_success: false,
  compile_error: "Line 3: error: ';' expected",
  full_compile_error: "Line 3: error: ';' expected\n        return new int[]{0, 1}\n                              ^",
  status_runtime: "N/A", memory: 0, code_answer: [], code_output: [], std_output_list: [""],
  total_correct: null, total_testcases: null, status_memory: "N/A", pretty_lang: "Java",
  submission_id: "runcode_1793538487.7014673_YFJGexjgS5", status_msg: "Compile Error", state: "SUCCESS",
};

export const SUBMIT = { submission_id: 2186991119 };

export const CHECK_SUBMIT_WRONG = {
  status_code: 11, lang: "java", run_success: true, status_runtime: "N/A", memory: 46724000,
  question_id: "1", compare_result: "1010000001", code_output: "[0,1]", std_output: "",
  last_testcase: "[3,2,4]\n6", expected_output: "[1,2]", finished: true,
  total_correct: 38, total_testcases: 66, runtime_percentile: null, status_memory: "N/A",
  memory_percentile: null, pretty_lang: "Java", submission_id: "2186991119",
  input_formatted: "[3,2,4], 6", input: "[3,2,4]\n6", status_msg: "Wrong Answer", state: "SUCCESS",
};

export const CHECK_SUBMIT_OK = {
  status_code: 10, lang: "java", run_success: true, status_runtime: "2 ms", memory: 46580000,
  question_id: "1", code_output: "", std_output: "", last_testcase: "", expected_output: "",
  finished: true, total_correct: 66, total_testcases: 66, runtime_percentile: 99.4165,
  status_memory: "46.6 MB", memory_percentile: 88.0619, pretty_lang: "Java",
  submission_id: "2186990503", status_msg: "Accepted", state: "SUCCESS",
};

export const SOLUTIONS_TWO_SUM = {
  data: {
    ugcArticleSolutionArticles: {
      edges: [
        {
          node: {
            title: "✅3 Method's || C++ || JAVA || PYTHON || Beginner Friendly🔥🔥🔥",
            slug: "3-methods-c-java-python-beginner-friendl-x595",
            topicId: 3619262,
            author: { userName: "rahulvarma5297" },
            reactions: [{ count: 12288, reactionType: "UPVOTE" }, { count: 15, reactionType: "THUMBS_DOWN" }],
          },
        },
        {
          node: {
            title: "【Video】Step by Step Easy Solution",
            slug: "video-step-by-step-easy-solution-by-niit-i4q6",
            topicId: 6754748,
            author: { userName: "niits" },
            reactions: [{ count: 4557, reactionType: "UPVOTE" }, { count: 4, reactionType: "THUMBS_DOWN" }],
          },
        },
      ],
    },
  },
};

// 正文里的换行是转义后的字面量 \n（反斜杠 + n），这里按原样保留
export const SOLUTION_DETAIL_1 = {
  data: {
    ugcArticleSolutionArticle: {
      content: "# Solution 3: (One-pass Hash Table)\\n```C++ []\\nclass Solution {};\\n```\\n```Java []\\nclass Solution {\\n    public int[] twoSum(int[] nums, int target) {\\n        return new int[]{};\\n    }\\n}\\n\\n```\\n```Python3 []\\nclass Solution:\\n    pass\\n```",
    },
  },
};

export const SOLUTION_DETAIL_2 = {
  data: { ugcArticleSolutionArticle: { content: "Use HashMap.\\n```java\\nclass Solution {}\\n```" } },
};
```

- [ ] **Step 2: 写失败的测试**

`lib/skills/leo-lc-transcoder/tests/api.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createApi, parseJudge, decodeContent, javaBlocks } from "../scripts/sites/leetcode-com/api.mjs";
import * as F from "./fixtures.mjs";

const CREDS = { LEETCODE_SESSION: "sess", csrftoken: "csrf" };
const CHECK_PATH = (id) => `GET /submissions/detail/${id}/check/`;

// 按 "方法 路径" 路由；GraphQL 请求按查询名路由为 "GQL 查询名"。
// 每个路由是响应队列，最后一个响应会被重复使用。
function setup(routes, deps = {}) {
  const calls = [];
  const sleeps = [];
  async function fetchImpl(url, init = {}) {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    let key = `${method} ${new URL(url).pathname}`;
    if (key === "POST /graphql/") key = `GQL ${/query (\w+)/.exec(body.query)[1]}`;
    calls.push({ key, url, init, body });
    const queue = routes[key];
    if (!queue) throw new Error(`unexpected request ${key}`);
    const r = queue.length > 1 ? queue.shift() : queue[0];
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  }
  const api = createApi(CREDS, { fetchImpl, sleep: async (ms) => sleeps.push(ms), ...deps });
  return { api, calls, sleeps };
}

test("search 解析题目列表，并带上 cookie 和 csrf 请求头", async () => {
  const { api, calls } = setup({ "GQL search": [{ body: F.SEARCH_3 }] });
  const list = await api.search("3");
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    id: "3",
    title: "Longest Substring Without Repeating Characters",
    slug: "longest-substring-without-repeating-characters",
    difficulty: "MEDIUM",
    paidOnly: false,
    status: "SOLVED",
    tags: ["hash-table", "string", "sliding-window"],
  });
  assert.equal(calls[0].body.variables.searchKeyword, "3");
  assert.match(calls[0].init.headers.cookie, /LEETCODE_SESSION=sess; csrftoken=csrf/);
  assert.equal(calls[0].init.headers["x-csrftoken"], "csrf");
});

test("show 按题号精确匹配 slug，并解析图片、模板和 metaData", async () => {
  const { api, calls } = setup({ "GQL search": [{ body: F.SEARCH_206 }], "GQL question": [{ body: F.QUESTION_206 }] });
  const q = await api.show("206");
  assert.equal(calls[1].body.variables.titleSlug, "reverse-linked-list");
  assert.equal(q.id, "206");
  assert.equal(q.url, "https://leetcode.com/problems/reverse-linked-list/");
  assert.deepEqual(q.images, [
    "https://assets.leetcode.com/uploads/2021/02/19/rev1ex1.jpg",
    "https://assets.leetcode.com/uploads/2021/02/19/rev1ex2.jpg",
  ]);
  assert.ok(q.javaTemplate.startsWith("class Solution {\n    public ListNode reverseList"));
  assert.equal(q.metaData.name, "reverseList");
  assert.deepEqual(q.exampleTestcases, ["[1,2,3,4,5]", "[1,2]", "[]"]);
  assert.deepEqual(q.tags, ["linked-list", "recursion"]);
});

test("show 传 slug 时不再搜索；会员题报 paid_only", async () => {
  const { api, calls } = setup({ "GQL question": [{ body: F.QUESTION_PAID }] });
  await assert.rejects(api.show("check-if-a-number-is-majority-element-in-a-sorted-array"), { code: "paid_only" });
  assert.equal(calls.length, 1);
});

test("run 默认用示例用例，轮询到结果；答案错误时改写为 Wrong Answer", async () => {
  const { api, calls, sleeps } = setup({
    "GQL question": [{ body: F.QUESTION_206 }],
    "POST /problems/reverse-linked-list/interpret_solution/": [{ body: F.INTERPRET }],
    [CHECK_PATH(F.INTERPRET.interpret_id)]: [{ body: F.CHECK_PENDING }, { body: F.CHECK_RUN_WRONG }],
  });
  const r = await api.run("reverse-linked-list", "class Solution {}");
  const post = calls.find((c) => c.key.endsWith("/interpret_solution/"));
  assert.deepEqual(post.body, {
    lang: "java",
    question_id: "206",
    typed_code: "class Solution {}",
    data_input: "[1,2,3,4,5]\n[1,2]\n[]",
  });
  assert.equal(post.init.headers.referer, "https://leetcode.com/problems/reverse-linked-list/");
  assert.equal(r.kind, "run");
  assert.equal(r.status, "Wrong Answer");
  assert.equal(r.passed, false);
  assert.deepEqual(r.output, ["[0,1]"]);
  assert.deepEqual(r.expected, ["[1,2]"]);
  assert.deepEqual(r.stdout, []);
  assert.equal(sleeps.length, 2);
});

test("run 使用自定义输入；编译错误时返回完整报错", async () => {
  const { api, calls } = setup({
    "GQL question": [{ body: F.QUESTION_206 }],
    "POST /problems/reverse-linked-list/interpret_solution/": [{ body: F.INTERPRET }],
    [CHECK_PATH(F.INTERPRET.interpret_id)]: [{ body: F.CHECK_RUN_COMPILE_ERROR }],
  });
  const r = await api.run("reverse-linked-list", "x", "[1]");
  assert.equal(calls.find((c) => c.key.endsWith("/interpret_solution/")).body.data_input, "[1]");
  assert.equal(r.status, "Compile Error");
  assert.equal(r.passed, false);
  assert.match(r.compileError, /';' expected/);
});

test("parseJudge：运行通过", () => {
  const r = parseJudge(F.CHECK_RUN_OK, "run");
  assert.equal(r.status, "Accepted");
  assert.equal(r.passed, true);
  assert.deepEqual(r.output, ["[0,1]", "[1,2]"]);
});

test("submit 不带 data_input，答案错误时给出失败用例", async () => {
  const { api, calls } = setup({
    "GQL question": [{ body: F.QUESTION_206 }],
    "POST /problems/reverse-linked-list/submit/": [{ body: F.SUBMIT }],
    [CHECK_PATH(F.SUBMIT.submission_id)]: [{ body: F.CHECK_SUBMIT_WRONG }],
  });
  const r = await api.submit("reverse-linked-list", "class Solution {}");
  const post = calls.find((c) => c.key.endsWith("/submit/"));
  assert.equal("data_input" in post.body, false);
  assert.equal(r.kind, "submit");
  assert.equal(r.status, "Wrong Answer");
  assert.equal(r.passed, false);
  assert.equal(r.totalCorrect, 38);
  assert.equal(r.totalTestcases, 66);
  assert.equal(r.lastTestcase, "[3,2,4]\n6");
  assert.equal(r.output, "[0,1]");
  assert.equal(r.expected, "[1,2]");
});

test("parseJudge：提交通过", () => {
  const r = parseJudge(F.CHECK_SUBMIT_OK, "submit");
  assert.equal(r.passed, true);
  assert.equal(r.runtimePercentile, 99.4165);
  assert.equal(r.lastTestcase, null);
});

test("403 视为登录失效", async () => {
  const { api } = setup({ "GQL search": [{ status: 403, body: "<!DOCTYPE html><title>Just a moment...</title>" }] });
  await assert.rejects(api.search("1"), { code: "auth" });
});

test("返回 HTML 时等待后重试", async () => {
  const { api, sleeps } = setup({ "GQL search": [{ body: "<!DOCTYPE html>" }, { body: F.SEARCH_3 }] });
  assert.equal((await api.search("3")).length, 2);
  assert.deepEqual(sleeps, [5000]);
});

test("连续 3 次返回异常后报 bad_response；429 报 rate_limited", async () => {
  const html = setup({ "GQL search": [{ body: "<!DOCTYPE html>" }] });
  await assert.rejects(html.api.search("3"), { code: "bad_response" });
  assert.equal(html.calls.length, 3);
  const limited = setup({ "GQL search": [{ status: 429, body: "slow down" }] });
  await assert.rejects(limited.api.search("3"), { code: "rate_limited" });
});

test("GraphQL 返回 errors 时报 graphql", async () => {
  const { api } = setup({ "GQL search": [{ body: { errors: [{ message: "bad field" }] } }] });
  await assert.rejects(api.search("3"), { code: "graphql", message: "bad field" });
});

test("判题一直 PENDING 时报 judge_timeout", async () => {
  const { api } = setup(
    {
      "GQL question": [{ body: F.QUESTION_206 }],
      "POST /problems/reverse-linked-list/submit/": [{ body: F.SUBMIT }],
      [CHECK_PATH(F.SUBMIT.submission_id)]: [{ body: F.CHECK_PENDING }],
    },
    { maxPolls: 3 },
  );
  await assert.rejects(api.submit("reverse-linked-list", "x"), { code: "judge_timeout" });
});

test("solutions 按票数取 Java 题解，解码正文并抽出 Java 代码", async () => {
  const { api, calls } = setup({
    "GQL solutions": [{ body: F.SOLUTIONS_TWO_SUM }],
    "GQL solution": [{ body: F.SOLUTION_DETAIL_1 }, { body: F.SOLUTION_DETAIL_2 }],
  });
  const list = await api.solutions("two-sum", 2);
  assert.deepEqual(calls[0].body.variables, { questionSlug: "two-sum", orderBy: "MOST_VOTES", tagSlugs: ["java"], first: 2, skip: 0 });
  assert.equal(calls[1].body.variables.topicId, "3619262");
  assert.equal(list[0].upvotes, 12288);
  assert.equal(list[0].author, "rahulvarma5297");
  assert.equal(list[0].url, "https://leetcode.com/problems/two-sum/solutions/3619262/3-methods-c-java-python-beginner-friendl-x595/");
  assert.ok(list[0].content.includes("\n```Java []\n"));
  assert.deepEqual(list[0].javaCode, ["class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[]{};\n    }\n}"]);
  assert.deepEqual(list[1].javaCode, ["class Solution {}"]);
});

test("decodeContent 只解码转义过的正文", () => {
  assert.equal(decodeContent("a\\nb"), "a\nb");
  assert.equal(decodeContent("a\nb \\n"), "a\nb \\n");
  assert.equal(decodeContent('bad "quote\\n'), 'bad "quote\\n');
  assert.deepEqual(javaBlocks("```python\nx\n```\n```JAVA []\ny\n```"), ["y"]);
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `node --test lib/skills/leo-lc-transcoder/tests/api.test.mjs`
Expected: FAIL，`Cannot find module .../api.mjs`

- [ ] **Step 4: 实现 api.mjs**

`lib/skills/leo-lc-transcoder/scripts/sites/leetcode-com/api.mjs`：

```js
// leetcode.com 接口封装。接口与字段于 2026-11-01 用浏览器抓包确认，样本见 tests/fixtures.mjs。
const BASE = "https://leetcode.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class LcError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const Q_ME = "query me { userStatus { isSignedIn username } }";
const Q_SEARCH = `query search($searchKeyword: String, $limit: Int, $skip: Int, $categorySlug: String, $filters: QuestionFilterInput, $sortBy: QuestionSortByInput) {
  problemsetQuestionListV2(searchKeyword: $searchKeyword, limit: $limit, skip: $skip, categorySlug: $categorySlug, filters: $filters, sortBy: $sortBy) {
    questions { questionFrontendId title titleSlug difficulty paidOnly status topicTags { name slug } }
  }
}`;
const Q_QUESTION = `query question($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug content difficulty isPaidOnly
    exampleTestcaseList metaData hints status topicTags { name slug } codeSnippets { langSlug code }
  }
}`;
const Q_SOLUTIONS = `query solutions($questionSlug: String!, $orderBy: ArticleOrderByEnum, $tagSlugs: [String!], $first: Int, $skip: Int) {
  ugcArticleSolutionArticles(questionSlug: $questionSlug, orderBy: $orderBy, tagSlugs: $tagSlugs, first: $first, skip: $skip, userInput: "", searchScope: CONTENT) {
    edges { node { title slug topicId author { userName } reactions { count reactionType } } }
  }
}`;
const Q_SOLUTION = "query solution($topicId: ID!) { ugcArticleSolutionArticle(topicId: $topicId) { content } }";

const trimEmpty = (list) => {
  const out = [...(list || [])];
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
};

export function parseSearch(body) {
  return body.data.problemsetQuestionListV2.questions.map((q) => ({
    id: q.questionFrontendId,
    title: q.title,
    slug: q.titleSlug,
    difficulty: q.difficulty,
    paidOnly: q.paidOnly,
    status: q.status,
    tags: q.topicTags.map((t) => t.slug),
  }));
}

export function parseQuestion(q) {
  if (!q) throw new LcError("not_found", "题目不存在");
  if (!q.content) throw new LcError("paid_only", `${q.questionFrontendId}. ${q.title} 是会员题，当前账号看不到题面`);
  return {
    id: q.questionFrontendId,
    questionId: q.questionId,
    title: q.title,
    slug: q.titleSlug,
    url: `${BASE}/problems/${q.titleSlug}/`,
    difficulty: q.difficulty,
    status: q.status,
    tags: q.topicTags.map((t) => t.slug),
    contentHtml: q.content,
    images: [...q.content.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    exampleTestcases: q.exampleTestcaseList || [],
    metaData: JSON.parse(q.metaData || "{}"),
    javaTemplate: q.codeSnippets?.find((s) => s.langSlug === "java")?.code ?? null,
    hints: q.hints || [],
  };
}

export function parseJudge(raw, kind) {
  const common = {
    kind,
    compileError: raw.full_compile_error || null,
    runtimeError: raw.full_runtime_error || raw.runtime_error || null,
    runtime: raw.status_runtime,
    memory: raw.status_memory,
  };
  if (kind === "run") {
    // 运行（interpret）时答案错误，status_msg 仍是 "Accepted"，要看 correct_answer
    const wrong = raw.status_msg === "Accepted" && raw.correct_answer === false;
    return {
      ...common,
      status: wrong ? "Wrong Answer" : raw.status_msg,
      passed: raw.status_msg === "Accepted" && raw.correct_answer === true,
      output: trimEmpty(raw.code_answer),
      expected: trimEmpty(raw.expected_code_answer),
      stdout: trimEmpty(raw.std_output_list),
    };
  }
  return {
    ...common,
    status: raw.status_msg,
    passed: raw.status_msg === "Accepted",
    submissionId: raw.submission_id,
    totalCorrect: raw.total_correct,
    totalTestcases: raw.total_testcases,
    lastTestcase: raw.last_testcase || null,
    output: raw.code_output || null,
    expected: raw.expected_output || null,
    stdout: raw.std_output || null,
    runtimePercentile: raw.runtime_percentile,
    memoryPercentile: raw.memory_percentile,
  };
}

// 题解正文里的换行是转义后的字面量 \n，按 JSON 字符串解码；解不开就原样返回
export function decodeContent(raw) {
  if (raw.includes("\n") || !raw.includes("\\n")) return raw;
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

export function javaBlocks(markdown) {
  return [...markdown.matchAll(/```(\w+)[^\n]*\n([\s\S]*?)```/g)]
    .filter((m) => m[1].toLowerCase() === "java")
    .map((m) => m[2].trimEnd());
}

export function createApi(creds, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 1500, maxPolls = 40 } = {}) {
  const headers = (referer) => ({
    "content-type": "application/json",
    cookie: `LEETCODE_SESSION=${creds.LEETCODE_SESSION}; csrftoken=${creds.csrftoken}`,
    "x-csrftoken": creds.csrftoken,
    origin: BASE,
    referer,
    "user-agent": UA,
  });

  async function request(pathname, { method = "GET", body, referer = `${BASE}/problemset/` } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(BASE + pathname, {
        method,
        headers: headers(referer),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) {
        throw new LcError("auth", "LeetCode 拒绝了请求：登录态失效，或被 Cloudflare 拦截");
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // 连续运行太快时 LeetCode 会返回 HTML 页面
      }
      if (res.ok && json) return json;
      if (attempt >= 2) {
        throw new LcError(res.status === 429 ? "rate_limited" : "bad_response", `LeetCode 返回异常（HTTP ${res.status}），请稍后再试`, text.slice(0, 200));
      }
      await sleep(5000 * (attempt + 1));
    }
  }

  async function gql(query, variables = {}) {
    const body = await request("/graphql/", { method: "POST", body: { query, variables } });
    if (body.errors?.length) throw new LcError("graphql", body.errors[0].message);
    return body;
  }

  async function search(keyword, limit = 10) {
    return parseSearch(
      await gql(Q_SEARCH, {
        searchKeyword: String(keyword),
        limit,
        skip: 0,
        categorySlug: "all-code-essentials",
        filters: { filterCombineType: "ALL" },
        sortBy: { sortField: "CUSTOM", sortOrder: "ASCENDING" },
      }),
    );
  }

  async function slugOf(idOrSlug) {
    const key = String(idOrSlug);
    if (!/^\d+$/.test(key)) return key;
    const hit = (await search(key, 20)).find((q) => q.id === key);
    if (!hit) throw new LcError("not_found", `找不到题号 ${key}`);
    return hit.slug;
  }

  async function show(idOrSlug) {
    return parseQuestion((await gql(Q_QUESTION, { titleSlug: await slugOf(idOrSlug) })).data.question);
  }

  async function judge(q, endpoint, payload, kind) {
    const started = await request(`/problems/${q.slug}/${endpoint}/`, { method: "POST", body: payload, referer: q.url });
    const id = started.interpret_id || started.submission_id;
    if (!id) throw new LcError("bad_response", "LeetCode 没有返回判题编号", JSON.stringify(started).slice(0, 200));
    for (let i = 0; i < maxPolls; i++) {
      await sleep(pollMs);
      const raw = await request(`/submissions/detail/${id}/check/`, { referer: q.url });
      if (raw.state === "SUCCESS") return parseJudge(raw, kind);
    }
    throw new LcError("judge_timeout", "等待判题结果超时，请稍后重试");
  }

  return {
    async whoami() {
      const s = (await gql(Q_ME)).data.userStatus;
      return { signedIn: s.isSignedIn, username: s.username };
    },
    search,
    show,
    async run(idOrSlug, code, input) {
      const q = await show(idOrSlug);
      const dataInput = input ?? q.exampleTestcases.join("\n");
      return judge(q, "interpret_solution", { lang: "java", question_id: q.questionId, typed_code: code, data_input: dataInput }, "run");
    },
    async submit(idOrSlug, code) {
      const q = await show(idOrSlug);
      return judge(q, "submit", { lang: "java", question_id: q.questionId, typed_code: code }, "submit");
    },
    async solutions(idOrSlug, top = 5) {
      const slug = await slugOf(idOrSlug);
      const body = await gql(Q_SOLUTIONS, { questionSlug: slug, orderBy: "MOST_VOTES", tagSlugs: ["java"], first: top, skip: 0 });
      const list = [];
      for (const { node } of body.data.ugcArticleSolutionArticles.edges) {
        const detail = await gql(Q_SOLUTION, { topicId: String(node.topicId) });
        const content = decodeContent(detail.data.ugcArticleSolutionArticle.content || "");
        list.push({
          title: node.title,
          author: node.author?.userName ?? null,
          upvotes: node.reactions.find((r) => r.reactionType === "UPVOTE")?.count ?? 0,
          topicId: String(node.topicId),
          url: `${BASE}/problems/${slug}/solutions/${node.topicId}/${node.slug}/`,
          content,
          javaCode: javaBlocks(content),
        });
      }
      return list;
    },
  };
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test lib/skills/leo-lc-transcoder/tests/api.test.mjs`
Expected: PASS（15 tests）

- [ ] **Step 6: 提交**

```bash
git add lib/skills/leo-lc-transcoder/scripts/sites/leetcode-com/api.mjs lib/skills/leo-lc-transcoder/tests/fixtures.mjs lib/skills/leo-lc-transcoder/tests/api.test.mjs
git commit -m "feat(leo-lc-transcoder): add leetcode.com api client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 统一入口 lc.mjs

**Files:**
- Create: `lib/skills/leo-lc-transcoder/scripts/lib/args.mjs`
- Create: `lib/skills/leo-lc-transcoder/scripts/lc.mjs`
- Test: `lib/skills/leo-lc-transcoder/tests/lc.test.mjs`

**Interfaces:**
- Consumes：Task 1 的 `configExists / readConfig / writeConfig / readCredentials / writeCredentials`；Task 2、3 的站点约定：`sites/<site>/cookie.mjs` 导出 `login(): Promise<creds>`，`sites/<site>/api.mjs` 导出 `createApi(creds)`，返回 `whoami / search / show / run / submit / solutions`；`LcError.code === "auth"` 表示登录失效。
- Produces：
  - `scripts/lib/args.mjs`：`parseArgs(argv: string[]): { pos: string[], opts: Record<string, string|true> }`
  - `scripts/lc.mjs`：`main(argv, { loadSiteImpl?, fetchImpl? }?): Promise<{ ok: true, data } | { ok: false, error: { code, message } }>`；直接运行时把结果以 JSON 打印到 stdout 并退出（失败时退出码为 1）
  - 命令：`config`、`config set k=v ...`、`login`、`search <关键词> [--limit N]`、`show <题号|slug> [--save-images 目录]`、`run <题号> <文件> [--input 文件]`、`submit <题号> <文件>`、`solutions <题号> [--top N]`
  - `show --save-images` 保存的文件名为 `LC{四位题号}-{原文件名}`，结果中附加 `savedImages: [{ url, file }]`

- [ ] **Step 1: 写失败的测试**

`lib/skills/leo-lc-transcoder/tests/lc.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test lib/skills/leo-lc-transcoder/tests/lc.test.mjs`
Expected: FAIL，`Cannot find module .../lc.mjs`

- [ ] **Step 3: 实现 args.mjs**

`lib/skills/leo-lc-transcoder/scripts/lib/args.mjs`：

```js
// 极简参数解析：--key value 或 --flag（后面没有值时为 true），其余为位置参数
export function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      pos.push(arg);
      continue;
    }
    const next = argv[i + 1];
    opts[arg.slice(2)] = next !== undefined && !next.startsWith("--") ? argv[++i] : true;
  }
  return { pos, opts };
}
```

- [ ] **Step 4: 实现 lc.mjs**

`lib/skills/leo-lc-transcoder/scripts/lc.mjs`：

```js
#!/usr/bin/env node
// leo-lc-transcoder 统一入口：node lc.mjs <命令> ...，结果以 JSON 输出到 stdout。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { configExists, readConfig, writeConfig, readCredentials, writeCredentials } from "./lib/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "用法：lc.mjs config [set k=v ...] | login | search <关键词或题号> | show <题号> [--save-images 目录] | run <题号> <文件> [--input 文件] | submit <题号> <文件> | solutions <题号> [--top N]";

const fail = (code, message) => Object.assign(new Error(message), { code });

function need(value, what) {
  if (!value) throw fail("usage", `缺少参数：${what}。${USAGE}`);
  return value;
}

// 站点约定：sites/<site>/api.mjs 导出 createApi(creds)，sites/<site>/cookie.mjs 导出 login()
async function loadSite(site) {
  const dir = path.join(HERE, "sites", site);
  if (!fs.existsSync(path.join(dir, "api.mjs"))) throw fail("unsupported_site", `不支持的站点：${site}`);
  const api = await import(pathToFileURL(path.join(dir, "api.mjs")).href);
  const cookie = await import(pathToFileURL(path.join(dir, "cookie.mjs")).href);
  return { createApi: api.createApi, login: cookie.login };
}

async function login(site) {
  const creds = await site.login();
  const me = await site.createApi(creds).whoami();
  if (!me.signedIn) throw fail("not_logged_in", "已读到 cookie，但 LeetCode 显示未登录，请在 Chrome 重新登录 leetcode.com");
  writeCredentials(creds);
  return { creds, me };
}

// 没有登录态先登录；遇到登录失效（code=auth）重新登录一次再重试
async function withApi(site, fn) {
  const creds = readCredentials() || (await login(site)).creds;
  try {
    return await fn(site.createApi(creds));
  } catch (err) {
    if (err.code !== "auth") throw err;
    return fn(site.createApi((await login(site)).creds));
  }
}

async function saveImages(images, id, dir, fetchImpl) {
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const url of images) {
    const file = path.join(dir, `LC${String(id).padStart(4, "0")}-${path.basename(new URL(url).pathname)}`);
    const res = await fetchImpl(url);
    if (!res.ok) throw fail("image_download_failed", `图片下载失败（HTTP ${res.status}）：${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    saved.push({ url, file });
  }
  return saved;
}

function parsePairs(pairs) {
  return Object.fromEntries(
    pairs.map((kv) => {
      const i = kv.indexOf("=");
      if (i < 1) throw fail("usage", `配置项格式应为 key=value：${kv}`);
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
}

export async function main(argv, { loadSiteImpl = loadSite, fetchImpl = fetch } = {}) {
  try {
    const { pos, opts } = parseArgs(argv);
    const [cmd, ...args] = pos;
    if (cmd === "config") {
      if (args[0] !== "set") return { ok: true, data: { exists: configExists(), config: readConfig() } };
      return { ok: true, data: writeConfig(parsePairs(args.slice(1))) };
    }
    const commands = ["login", "search", "show", "run", "submit", "solutions"];
    if (!commands.includes(cmd)) throw fail("usage", USAGE);
    const site = await loadSiteImpl(readConfig().site);
    let data;
    switch (cmd) {
      case "login":
        data = { username: (await login(site)).me.username };
        break;
      case "search": {
        const keyword = need(args.join(" "), "关键词或题号");
        data = await withApi(site, (api) => api.search(keyword, Number(opts.limit) || 10));
        break;
      }
      case "show": {
        const id = need(args[0], "题号或 slug");
        data = await withApi(site, (api) => api.show(id));
        if (opts["save-images"]) {
          data.savedImages = await saveImages(data.images, data.id, path.resolve(String(opts["save-images"])), fetchImpl);
        }
        break;
      }
      case "run":
      case "submit": {
        const id = need(args[0], "题号");
        const code = fs.readFileSync(need(args[1], "Java 文件"), "utf8");
        const input = opts.input ? fs.readFileSync(String(opts.input), "utf8").trimEnd() : undefined;
        data = await withApi(site, (api) => (cmd === "run" ? api.run(id, code, input) : api.submit(id, code)));
        break;
      }
      case "solutions": {
        const id = need(args[0], "题号");
        data = await withApi(site, (api) => api.solutions(id, Number(opts.top) || 5));
        break;
      }
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: { code: err.code || "error", message: err.message } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await main(process.argv.slice(2));
  // 写完再退出：直接 process.exit 可能截断管道里的输出；显式退出保证不会挂着
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(result.ok ? 0 : 1));
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test --test-concurrency=1 lib/skills/leo-lc-transcoder/tests/lc.test.mjs`
Expected: PASS（8 tests）

- [ ] **Step 6: 跑一遍目前所有测试**

Run: `npm run test:leo-lc-transcoder`
Expected: PASS（config 3 + cookie 6 + api 15 + lc 8）

- [ ] **Step 7: 提交**

```bash
git add lib/skills/leo-lc-transcoder/scripts/lib/args.mjs lib/skills/leo-lc-transcoder/scripts/lc.mjs lib/skills/leo-lc-transcoder/tests/lc.test.mjs
git commit -m "feat(leo-lc-transcoder): add lc.mjs cli with auto re-login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 算法动画（T.java + viz.mjs + player.html）

原则：图上的每一步都来自真实运行的代码。`viz.mjs` 把 `assets/T.java` 作为顶层类追加到演示程序末尾，用 `java Demo.java` 运行（单文件源码启动，第一个顶层类必须带 `main`），收集以 `@@T ` 开头的帧，嵌入播放器。行号由 T 从调用栈读取；因为 T 追加在文件末尾，原程序的行号保持不变。

**Files:**
- Create: `lib/skills/leo-lc-transcoder/assets/T.java`
- Create: `lib/skills/leo-lc-transcoder/assets/player.html`
- Create: `lib/skills/leo-lc-transcoder/scripts/viz.mjs`
- Test: `lib/skills/leo-lc-transcoder/tests/viz.test.mjs`

**Interfaces:**
- Consumes：Task 1 的 `readConfig()`（读取 `java_home`）、Task 4 的 `parseArgs`
- Produces：
  - Java 侧（`T`）：`T.frame(String note, Object... views)`；视图 `T.arr(name, array, "标签", 下标, ...)`、`T.range(name, array, from, to, "标签", 下标, ...)`、`T.grid(name, matrix, row, col)`、`T.tree(name, root, 高亮节点...)`（节点有 `val` 加 `left`/`right`，或 `val` 加 `kids`）、`T.stack(name, Iterable)`、`T.vars("名", 值, ...)`；单次运行超过 2000 帧时抛出异常
  - 帧 JSON：`{ line: number, note: string, views: View[] }`，View 带 `kind`（`array|grid|tree|stack|vars`）和 `name`
  - `viz.mjs`：`parseFrames(stdout) → { frames, output }`、`buildHtml(template, { title, code, frames }) → string`、`runDemo(file, { javaHome?, timeoutMs? }) → { source, frames, output }`、`main(argv) → { ok, data: { out, frames, output } }`
  - 播放器模板中的占位：`<title>算法演示</title>`、`/*__LC_DATA__*/null`

- [ ] **Step 1: 写失败的测试**

`lib/skills/leo-lc-transcoder/tests/viz.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrames, buildHtml, main } from "../scripts/viz.mjs";
import { freshHome } from "./helpers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAYER = fs.readFileSync(path.join(ROOT, "assets", "player.html"), "utf8");
const HAS_JAVA = spawnSync("java", ["-version"]).status === 0;

const DEMO = `public class Demo {
    static class TreeNode { int val; TreeNode left, right; TreeNode(int v) { val = v; } }
    public static void main(String[] args) {
        int[] nums = {2, 7, 11, 15};
        int l = 0, r = nums.length - 1;
        while (l < r) {
            T.frame("比较两端", T.range("nums", nums, l, r, "L", l, "R", r), T.vars("sum", nums[l] + nums[r])); // @mark
            if (nums[l] + nums[r] > 9) r--; else break;
        }
        TreeNode root = new TreeNode(1);
        root.left = new TreeNode(2);
        T.frame("树", T.tree("root", root, root.left));
        java.util.ArrayDeque<String> st = new java.util.ArrayDeque<>();
        st.push("f(3)");
        st.push("f(2)");
        T.frame("栈和表", T.stack("calls", st), T.grid("dp", new int[][] {{1, 2}, {3, 4}}, 1, 0));
    }
}
`;

test("parseFrames 分出轨迹帧和普通输出", () => {
  const { frames, output } = parseFrames('hello\n@@T {"line":3,"note":"a","views":[]}\r\n\n');
  assert.deepEqual(frames, [{ line: 3, note: "a", views: [] }]);
  assert.deepEqual(output, ["hello"]);
});

test("buildHtml 嵌入数据并转义，不引用外部资源", () => {
  const html = buildHtml(PLAYER, { title: "3. <无重复>", code: "class A {}", frames: [{ line: 1, note: "</script>$&", views: [] }] });
  assert.match(html, /<title>3\. &lt;无重复&gt;<\/title>/);
  assert.ok(html.includes("\\u003c/script>$&"));
  assert.ok(!html.includes("/*__LC_DATA__*/null"));
  assert.doesNotMatch(html, /(src|href)="https?:/);
});

test("运行 Java 演示程序，记录数组、变量、树、栈和表", { skip: !HAS_JAVA && "本机没有 java" }, () => {
  freshHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-viz-test-"));
  const src = path.join(dir, "Demo.java");
  fs.writeFileSync(src, DEMO);
  const out = path.join(dir, "out", "demo.html");
  const r = main([src, "--out", out, "--title", "演示"]);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.frames, 5);

  const html = fs.readFileSync(out, "utf8");
  const data = JSON.parse(/const DATA = (.*);\n/.exec(html)[1]);
  const markLine = DEMO.split("\n").findIndex((s) => s.includes("// @mark")) + 1;
  const [f0, , f2, f3, f4] = data.frames;

  assert.equal(data.title, "演示");
  assert.equal(data.code, DEMO);
  assert.equal(f0.line, markLine);
  assert.equal(f0.note, "比较两端");
  assert.equal(f0.views[0].kind, "array");
  assert.deepEqual(f0.views[0].items, [2, 7, 11, 15]);
  assert.deepEqual(f0.views[0].range, [0, 3]);
  assert.deepEqual(f0.views[0].marks, { L: 0, R: 3 });
  assert.deepEqual(f0.views[1], { values: { sum: 17 }, kind: "vars", name: "变量" });
  assert.equal(f2.views[1].values.sum, 9);

  const tree = f3.views[0];
  assert.equal(tree.kind, "tree");
  assert.equal(tree.root.val, 1);
  assert.equal(tree.root.left.val, 2);
  assert.equal(tree.root.right, null);
  assert.deepEqual(tree.hl, [tree.root.left.id]);

  assert.deepEqual(f4.views[0].items, ["f(2)", "f(3)"]);
  assert.deepEqual(f4.views[1].cells, [[1, 2], [3, 4]]);
  assert.deepEqual(f4.views[1].cur, [1, 0]);
});

test("没有调用 T.frame 时报 no_frames；编译失败时报 java_failed", { skip: !HAS_JAVA && "本机没有 java" }, () => {
  freshHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-viz-test-"));
  const empty = path.join(dir, "Empty.java");
  fs.writeFileSync(empty, "public class Empty { public static void main(String[] a) { System.out.println(1); } }");
  assert.equal(main([empty, "--out", path.join(dir, "e.html")]).error.code, "no_frames");
  const broken = path.join(dir, "Broken.java");
  fs.writeFileSync(broken, "public class Broken { public static void main(String[] a) { int x = } }");
  assert.equal(main([broken, "--out", path.join(dir, "b.html")]).error.code, "java_failed");
});

test("缺少 --out 时返回用法", () => {
  assert.equal(main(["Demo.java"]).error.code, "usage");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test lib/skills/leo-lc-transcoder/tests/viz.test.mjs`
Expected: FAIL，`ENOENT ... assets/player.html`

- [ ] **Step 3: 实现 T.java**

`lib/skills/leo-lc-transcoder/assets/T.java`：

```java
// leo-lc-transcoder 轨迹记录器：viz.mjs 会把本文件追加到演示程序末尾一起运行。
// 用法：T.frame("中文说明", T.arr(...), T.vars(...))，每调用一次记录一帧，行号自动取调用处。
// 只用 JDK 11 就有的语法。
class T {
    private static final java.util.IdentityHashMap<Object, Integer> IDS = new java.util.IdentityHashMap<>();
    private static int frames = 0;

    static void frame(String note, Object... views) {
        if (++frames > 2000) throw new IllegalStateException("帧数超过 2000，请换更小的输入");
        int line = new Throwable().getStackTrace()[1].getLineNumber();
        StringBuilder sb = new StringBuilder("@@T {\"line\":").append(line).append(",\"note\":");
        json(sb, note, 0);
        sb.append(",\"views\":");
        json(sb, views, 0);
        System.out.println(sb.append('}'));
    }

    /** 数组 + 指针：marks 成对给出，如 "L", l, "R", r */
    static java.util.Map<String, Object> arr(String name, Object array, Object... marks) {
        return view("array", name, "items", array, "marks", pairs(marks));
    }

    /** 数组 + 闭区间 [from, to] 高亮（滑动窗口） */
    static java.util.Map<String, Object> range(String name, Object array, int from, int to, Object... marks) {
        java.util.Map<String, Object> v = arr(name, array, marks);
        v.put("range", new int[] {from, to});
        return v;
    }

    /** 二维表格，高亮 (row, col)（动态规划） */
    static java.util.Map<String, Object> grid(String name, Object matrix, int row, int col) {
        return view("grid", name, "cells", matrix, "cur", new int[] {row, col});
    }

    /** 树：节点有 val 加 left/right（二叉树），或 val 加 kids（List，递归树 / 回溯树） */
    static java.util.Map<String, Object> tree(String name, Object root, Object... highlight) {
        java.util.Map<String, Object> v = view("tree", name, "root", node(root, 0));
        java.util.List<Integer> hl = new java.util.ArrayList<>();
        for (Object h : highlight) if (h != null) hl.add(id(h));
        v.put("hl", hl);
        return v;
    }

    /** 栈：第一个元素画在最上面（ArrayDeque.push 进去的是第一个） */
    static java.util.Map<String, Object> stack(String name, Iterable<?> items) {
        java.util.List<Object> list = new java.util.ArrayList<>();
        for (Object o : items) list.add(o);
        return view("stack", name, "items", list);
    }

    /** 标量变量：T.vars("sum", sum, "best", best) */
    static java.util.Map<String, Object> vars(Object... kv) {
        return view("vars", "变量", "values", pairs(kv));
    }

    private static java.util.Map<String, Object> view(String kind, String name, Object... kv) {
        java.util.Map<String, Object> v = pairs(kv);
        v.put("kind", kind);
        v.put("name", name);
        return v;
    }

    private static java.util.Map<String, Object> pairs(Object... kv) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static int id(Object o) {
        return IDS.computeIfAbsent(o, k -> IDS.size() + 1);
    }

    private static Object node(Object n, int depth) {
        if (n == null || depth > 64) return null;
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", id(n));
        m.put("val", field(n, "val"));
        Object kids = field(n, "kids");
        if (kids instanceof Iterable) {
            java.util.List<Object> list = new java.util.ArrayList<>();
            for (Object k : (Iterable<?>) kids) list.add(node(k, depth + 1));
            m.put("kids", list);
        } else {
            m.put("left", node(field(n, "left"), depth + 1));
            m.put("right", node(field(n, "right"), depth + 1));
        }
        return m;
    }

    private static Object field(Object o, String name) {
        try {
            java.lang.reflect.Field f = o.getClass().getDeclaredField(name);
            f.setAccessible(true);
            return f.get(o);
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    private static void json(StringBuilder sb, Object o, int depth) {
        if (o == null || depth > 64) {
            sb.append("null");
            return;
        }
        boolean nonFinite = (o instanceof Double && !Double.isFinite((Double) o)) || (o instanceof Float && !Float.isFinite((Float) o));
        if ((o instanceof Number && !nonFinite) || o instanceof Boolean) {
            sb.append(o);
            return;
        }
        if (o instanceof java.util.Map) {
            sb.append('{');
            boolean first = true;
            for (java.util.Map.Entry<?, ?> e : ((java.util.Map<?, ?>) o).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                json(sb, String.valueOf(e.getKey()), depth + 1);
                sb.append(':');
                json(sb, e.getValue(), depth + 1);
            }
            sb.append('}');
            return;
        }
        if (o instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object x : (Iterable<?>) o) {
                if (!first) sb.append(',');
                first = false;
                json(sb, x, depth + 1);
            }
            sb.append(']');
            return;
        }
        if (o.getClass().isArray()) {
            sb.append('[');
            int n = java.lang.reflect.Array.getLength(o);
            for (int i = 0; i < n; i++) {
                if (i > 0) sb.append(',');
                json(sb, java.lang.reflect.Array.get(o, i), depth + 1);
            }
            sb.append(']');
            return;
        }
        sb.append('"');
        for (char c : String.valueOf(o).toCharArray()) {
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        sb.append('"');
    }
}
```

- [ ] **Step 4: 实现播放器 player.html**

`lib/skills/leo-lc-transcoder/assets/player.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>算法演示</title>
<style>
:root { --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --line: #e7e5e4; --card: #ffffff; --hl: #fde68a; --accent: #2563eb; --range: #dbeafe; --cur: #fecaca; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --line: #44403c; --card: #292524; --hl: #713f12; --accent: #60a5fa; --range: #1e3a8a; --cur: #7f1d1d; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
header { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid var(--line); font-weight: 600; }
header .keys { color: var(--muted); font-weight: 400; font-size: 12px; }
main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; padding: 16px; }
@media (max-width: 800px) { main { grid-template-columns: minmax(0, 1fr); } }
pre#code { position: relative; margin: 0; max-height: 70vh; overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 0; font: 13px/1.6 ui-monospace, Menlo, Consolas, monospace; }
.ln { display: block; padding: 0 12px; white-space: pre; }
.ln.on { background: var(--hl); }
.ln i { display: inline-block; width: 2.5em; color: var(--muted); font-style: normal; user-select: none; }
#note { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; min-height: 44px; }
.view { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; overflow-x: auto; }
.view h4 { margin: 0 0 8px; font-size: 12px; font-weight: 500; color: var(--muted); }
.cells { display: flex; gap: 4px; }
.cell { min-width: 36px; text-align: center; }
.cell .v { border: 1px solid var(--line); border-radius: 4px; padding: 6px 4px; font-family: ui-monospace, Menlo, monospace; }
.cell.in .v { background: var(--range); }
.cell.out .v { border-style: dashed; }
.cell .i { font-size: 11px; color: var(--muted); }
.cell .m { min-height: 16px; font-size: 11px; font-weight: 600; color: var(--accent); }
table { border-collapse: collapse; font-family: ui-monospace, Menlo, monospace; }
th { color: var(--muted); font-weight: 400; font-size: 11px; padding: 2px 6px; }
td { border: 1px solid var(--line); padding: 4px 8px; min-width: 32px; text-align: center; }
td.cur { background: var(--cur); }
.stack div { border: 1px solid var(--line); border-radius: 4px; padding: 4px 8px; margin-bottom: 4px; font-family: ui-monospace, Menlo, monospace; }
.stack div:first-child { border-color: var(--accent); }
.vars span { display: inline-block; margin: 0 16px 4px 0; font-family: ui-monospace, Menlo, monospace; }
.empty { color: var(--muted); }
svg line { stroke: var(--muted); }
svg circle { fill: var(--card); stroke: var(--muted); }
svg circle.on { fill: var(--hl); stroke: var(--accent); stroke-width: 2; }
svg text { fill: var(--fg); font: 13px ui-monospace, Menlo, monospace; }
footer { position: sticky; bottom: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 16px; background: var(--bg); border-top: 1px solid var(--line); }
button, select { font: inherit; padding: 4px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--fg); cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }
#pos { margin-left: auto; color: var(--muted); }
</style>
</head>
<body>
<header><span id="title"></span><span class="keys">← → 单步 · 空格 播放 / 暂停</span></header>
<main>
  <pre id="code" aria-label="代码"></pre>
  <section>
    <div id="note" aria-live="polite"></div>
    <div id="views"></div>
  </section>
</main>
<footer>
  <button id="first" type="button" title="回到第一步">⏮</button>
  <button id="prev" type="button">◀ 上一步</button>
  <button id="play" type="button">▶ 播放</button>
  <button id="next" type="button">下一步 ▶</button>
  <label>速度 <select id="speed"><option value="1500">慢</option><option value="800" selected>中</option><option value="300">快</option></select></label>
  <span id="pos"></span>
</footer>
<script>
const DATA = /*__LC_DATA__*/null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (v) => (v === null || v === undefined ? "·" : typeof v === "object" ? JSON.stringify(v) : String(v));

function renderArray(v) {
  const items = v.items || [];
  const marks = {};
  for (const [label, idx] of Object.entries(v.marks || {})) (marks[idx] = marks[idx] || []).push(label);
  const markIdx = Object.keys(marks).map(Number).filter((i) => Number.isInteger(i) && i >= 0);
  const n = Math.max(items.length, markIdx.length ? Math.max(...markIdx) + 1 : 0);
  const [from, to] = v.range || [0, -1];
  let html = "";
  for (let i = 0; i < n; i++) {
    const cls = ["cell", i >= from && i <= to ? "in" : "", i >= items.length ? "out" : ""].join(" ");
    const value = i < items.length ? esc(fmt(items[i])) : "&nbsp;";
    html += `<div class="${cls}"><div class="i">${i}</div><div class="v">${value}</div><div class="m">${esc((marks[i] || []).join(" "))}</div></div>`;
  }
  return `<div class="cells">${html}</div>`;
}

function renderGrid(v) {
  const cells = v.cells || [];
  const [cr, cc] = v.cur || [-1, -1];
  const width = Math.max(0, ...cells.map((row) => (row || []).length));
  const head = `<tr><th></th>${Array.from({ length: width }, (_, c) => `<th>${c}</th>`).join("")}</tr>`;
  const rows = cells.map((row, r) => `<tr><th>${r}</th>${(row || []).map((x, c) => `<td class="${r === cr && c === cc ? "cur" : ""}">${esc(fmt(x))}</td>`).join("")}</tr>`);
  return `<table>${head}${rows.join("")}</table>`;
}

// 二叉树按中序排横坐标；多叉树（kids）叶子依次排开，父节点居中
function layoutTree(root) {
  const out = [];
  let next = 0;
  (function walk(n, d) {
    if (!n) return null;
    let x;
    if (Array.isArray(n.kids)) {
      const xs = n.kids.map((k) => walk(k, d + 1)).filter((k) => k !== null);
      x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : next++;
    } else {
      walk(n.left, d + 1);
      x = next++;
      walk(n.right, d + 1);
    }
    out.push({ n, d, x });
    return x;
  })(root, 0);
  return out;
}

function renderTree(v) {
  const nodes = layoutTree(v.root);
  if (!nodes.length) return '<div class="empty">（空树）</div>';
  const W = 48, H = 60, R = 17;
  const byId = new Map(nodes.map((p) => [p.n.id, p]));
  const X = (p) => p.x * W + W / 2;
  const Y = (p) => p.d * H + R + 4;
  const hl = new Set(v.hl || []);
  let edges = "";
  let dots = "";
  for (const p of nodes) {
    for (const k of p.n.kids || [p.n.left, p.n.right]) {
      const q = k && byId.get(k.id);
      if (q) edges += `<line x1="${X(p)}" y1="${Y(p)}" x2="${X(q)}" y2="${Y(q)}"/>`;
    }
    dots += `<circle cx="${X(p)}" cy="${Y(p)}" r="${R}" class="${hl.has(p.n.id) ? "on" : ""}"/><text x="${X(p)}" y="${Y(p) + 4}" text-anchor="middle">${esc(fmt(p.n.val))}</text>`;
  }
  const w = (Math.max(...nodes.map((p) => p.x)) + 1) * W;
  const h = (Math.max(...nodes.map((p) => p.d)) + 1) * H;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(v.name)}">${edges}${dots}</svg>`;
}

function renderStack(v) {
  const items = v.items || [];
  if (!items.length) return '<div class="empty">（空）</div>';
  return `<div class="stack">${items.map((x, i) => `<div>${i === 0 ? "<b>栈顶</b> " : ""}${esc(fmt(x))}</div>`).join("")}</div>`;
}

function renderVars(v) {
  return `<div class="vars">${Object.entries(v.values || {}).map(([k, x]) => `<span>${esc(k)} = <b>${esc(fmt(x))}</b></span>`).join("")}</div>`;
}

const RENDER = { array: renderArray, grid: renderGrid, tree: renderTree, stack: renderStack, vars: renderVars };
let at = 0;
let timer = null;

function render() {
  const f = DATA.frames[at];
  for (const el of document.querySelectorAll(".ln.on")) el.classList.remove("on");
  const ln = document.querySelector(`.ln[data-n="${f.line}"]`);
  if (ln) {
    ln.classList.add("on");
    // 只滚动代码框，不用 scrollIntoView，以免带着整页横向滚动
    const box = $("code");
    if (ln.offsetTop < box.scrollTop || ln.offsetTop + ln.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = ln.offsetTop - box.clientHeight / 3;
    }
  }
  $("note").textContent = f.note || "";
  $("views").innerHTML = (f.views || [])
    .map((v) => `<div class="view"><h4>${esc(v.name || v.kind)}</h4>${(RENDER[v.kind] || ((x) => `<pre>${esc(JSON.stringify(x))}</pre>`))(v)}</div>`)
    .join("");
  $("pos").textContent = `第 ${at + 1} / ${DATA.frames.length} 步`;
  $("first").disabled = $("prev").disabled = at === 0;
  $("next").disabled = at === DATA.frames.length - 1;
}

function go(i) {
  at = Math.max(0, Math.min(DATA.frames.length - 1, i));
  render();
  if (timer && at === DATA.frames.length - 1) stop();
}

function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "▶ 播放";
}

function toggle() {
  if (timer) return stop();
  if (at === DATA.frames.length - 1) go(0);
  $("play").textContent = "⏸ 暂停";
  timer = setInterval(() => go(at + 1), Number($("speed").value));
}

if (!DATA) {
  document.body.textContent = "这是播放器模板，请用 viz.mjs 生成动画页面。";
} else {
  $("title").textContent = DATA.title;
  $("code").innerHTML = DATA.code
    .split(/\r?\n/)
    .map((s, i) => `<span class="ln" data-n="${i + 1}"><i>${i + 1}</i>${esc(s) || " "}</span>`)
    .join("");
  $("first").onclick = () => go(0);
  $("prev").onclick = () => go(at - 1);
  $("next").onclick = () => go(at + 1);
  $("play").onclick = toggle;
  $("speed").onchange = () => {
    if (timer) {
      stop();
      toggle();
    }
  };
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT") return;
    if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else if (e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  render();
}
</script>
</body>
</html>
```

- [ ] **Step 5: 实现 viz.mjs**

`lib/skills/leo-lc-transcoder/scripts/viz.mjs`：

```js
#!/usr/bin/env node
// 运行带 T.frame(...) 的 Java 演示程序，把轨迹嵌进播放器，生成可离线打开的单个 HTML。
// 用法：node viz.mjs <Demo.java> --out <输出.html> [--title 标题]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { readConfig } from "./lib/config.mjs";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const fail = (code, message) => Object.assign(new Error(message), { code });

export function parseFrames(stdout) {
  const frames = [];
  const output = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("@@T ")) frames.push(JSON.parse(line.slice(4)));
    else if (line.trim()) output.push(line);
  }
  return { frames, output };
}

export function buildHtml(template, { title, code, frames }) {
  // "<" 转成 \u003c，避免代码或说明里的 </script> 截断脚本
  const json = JSON.stringify({ title, code, frames }).replace(/</g, "\\u003c");
  const safeTitle = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return template
    .replace("<title>算法演示</title>", () => `<title>${safeTitle}</title>`)
    .replace("/*__LC_DATA__*/null", () => json);
}

const javaBin = (javaHome) => (javaHome ? path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java") : "java");

export function runDemo(sourceFile, { javaHome, timeoutMs = 20000 } = {}) {
  const source = fs.readFileSync(sourceFile, "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-viz-"));
  try {
    // T 追加在末尾，原程序的行号不变；单文件源码启动只编译这一个文件
    const file = path.join(dir, path.basename(sourceFile));
    fs.writeFileSync(file, `${source.trimEnd()}\n\n${fs.readFileSync(path.join(ASSETS, "T.java"), "utf8")}`, "utf8");
    const r = spawnSync(javaBin(javaHome), ["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", file], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error?.code === "ETIMEDOUT") throw fail("java_timeout", `Java 程序运行超过 ${timeoutMs / 1000} 秒，检查是否有死循环`);
    if (r.error) throw fail("java_unavailable", `无法运行 java：${r.error.message}`);
    if (r.status !== 0) throw fail("java_failed", r.stderr.trim() || `java 退出码 ${r.status}`);
    return { source, ...parseFrames(r.stdout) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function main(argv) {
  try {
    const { pos, opts } = parseArgs(argv);
    if (!pos[0] || !opts.out || opts.out === true) throw fail("usage", "用法：viz.mjs <Demo.java> --out <输出.html> [--title 标题]");
    const { source, frames, output } = runDemo(path.resolve(pos[0]), { javaHome: readConfig().java_home });
    if (!frames.length) throw fail("no_frames", "没有记录到任何帧：请在关键位置调用 T.frame(...)");
    const title = String(opts.title || path.basename(pos[0], ".java"));
    const out = path.resolve(String(opts.out));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buildHtml(fs.readFileSync(path.join(ASSETS, "player.html"), "utf8"), { title, code: source, frames }), "utf8");
    return { ok: true, data: { out, frames: frames.length, output } };
  } catch (err) {
    return { ok: false, error: { code: err.code || "error", message: err.message } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(result.ok ? 0 : 1));
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `node --test lib/skills/leo-lc-transcoder/tests/viz.test.mjs`
Expected: PASS（5 tests；本机有 JDK 25，Java 相关的两个测试不会跳过）

- [ ] **Step 7: 在浏览器里看一眼生成的页面**

```bash
mkdir -p ${TMPDIR:-/tmp}/lc-viz-check && cat > ${TMPDIR:-/tmp}/lc-viz-check/Demo.java <<'EOF'
public class Demo {
    public static void main(String[] args) {
        String s = "abcabcbb";
        java.util.Map<Character, Integer> window = new java.util.HashMap<>();
        int left = 0, best = 0;
        for (int right = 0; right < s.length(); right++) {
            char c = s.charAt(right);
            window.merge(c, 1, Integer::sum);
            T.frame("右指针把 " + c + " 放进窗口", T.range("s", s.toCharArray(), left, right, "L", left, "R", right), T.vars("best", best));
            while (window.get(c) > 1) {
                window.merge(s.charAt(left), -1, Integer::sum);
                left++;
                T.frame("出现重复，左指针右移", T.range("s", s.toCharArray(), left, right, "L", left, "R", right), T.vars("best", best));
            }
            best = Math.max(best, right - left + 1);
        }
        T.frame("结束，最长无重复子串长度为 " + best, T.vars("best", best));
    }
}
EOF
node lib/skills/leo-lc-transcoder/scripts/viz.mjs ${TMPDIR:-/tmp}/lc-viz-check/Demo.java --out ${TMPDIR:-/tmp}/lc-viz-check/demo.html --title "3. 无重复字符的最长子串"
```

Expected: 输出 `"ok": true`。用浏览器打开 `${TMPDIR:-/tmp}/lc-viz-check/demo.html`，确认以下几点：左侧代码高亮跟着步骤移动；数组格子里窗口区间是蓝色底，下方标出 L/R；"下一步"、"播放"和键盘 ← → 空格都能用；窗口缩到 390px 宽时布局变成单列。

- [ ] **Step 8: 提交**

```bash
git add lib/skills/leo-lc-transcoder/assets lib/skills/leo-lc-transcoder/scripts/viz.mjs lib/skills/leo-lc-transcoder/tests/viz.test.mjs
git commit -m "feat(leo-lc-transcoder): add algorithm trace player" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 参考资料（题型目录、讲题示范、卡片格式）

**Files:**
- Create: `lib/skills/leo-lc-transcoder/references/pattern-catalog.md`
- Create: `lib/skills/leo-lc-transcoder/references/teaching-examples.md`
- Create: `lib/skills/leo-lc-transcoder/references/card-templates.md`

**Interfaces:**
- Produces：题型编号 `P01`～`P13` 及其名称，供 SKILL.md、题型卡文件名（`题型/P03_滑动窗口.md`）和 LEARNING.md 掌握度表使用：P01 哈希表、P02 双指针、P03 滑动窗口、P04 前缀和、P05 二分查找、P06 单调栈、P07 链表、P08 二叉树递归、P09 BFS、P10 回溯、P11 动态规划、P12 堆、P13 图与拓扑排序。

- [ ] **Step 1: 写 pattern-catalog.md**

`lib/skills/leo-lc-transcoder/references/pattern-catalog.md`：

````markdown
# 题型目录

每个题型包含：识别信号、Java 模板（`【变化点】` 标出不同题目要改的地方）、易错点、模板题。讲题和写题型卡都以这里为准；新增题型按同样格式追加 `P14` 起的条目。

## 数据规模 → 允许的复杂度（解题四问第 1 问）

按每秒约 10⁸ 次简单运算估算：

| n 的范围 | 允许的复杂度 | 常见做法 |
|---|---|---|
| n ≤ 10 | O(n!)、O(2ⁿ·n) | 回溯全排列 |
| n ≤ 20 | O(2ⁿ) | 回溯子集、状态压缩 |
| n ≤ 500 | O(n³) | 三重循环、区间 DP |
| n ≤ 5000 | O(n²) | 双重循环、二维 DP |
| n ≤ 10⁵～10⁶ | O(n log n)、O(n) | 排序、二分、堆、双指针、滑动窗口、哈希、前缀和 |
| n 很大或是值域 | O(log n)、O(1) | 二分答案、数学 |

---

## P01 哈希表

**识别信号**
- "找两个数 / 两个元素满足某个关系"，暴力是两重循环
- "是否出现过""出现几次""分组"
- 需要 O(1) 查"之前见过没有"

**模板**

```java
Map<Integer, Integer> seen = new HashMap<>();   // 值 -> 下标（或次数）
for (int i = 0; i < nums.length; i++) {
    int need = target - nums[i];                // 【变化点】要找的"另一半"
    if (seen.containsKey(need)) return new int[] {seen.get(need), i};
    seen.put(nums[i], i);                       // 先查再放，避免自己和自己配对
}
return new int[0];
```

**易错点**：先放后查会让一个元素和自己配对；分组题的 key 要选对（如字母异位词用排序后的字符串）。

**模板题**：1. 两数之和、49. 字母异位词分组、128. 最长连续序列

## P02 双指针

这里指相向双指针（一左一右往中间走）；同向的快慢指针见 P07 链表。

**识别信号**
- 数组**有序**（或可以先排序），找满足条件的一对
- "原地""两端""回文"
- 暴力两重循环，但移动一端就能排除一批答案

**模板**

```java
int l = 0, r = nums.length - 1;
while (l < r) {
    int sum = nums[l] + nums[r];
    if (sum == target) {        // 【变化点】命中时做什么（记录答案、去重后继续）
        l++;
        r--;
    } else if (sum < target) {
        l++;                    // 和小了：左边换大一点的
    } else {
        r--;                    // 和大了：右边换小一点的
    }
}
```

**易错点**：三数之和要跳过重复值；循环条件是 `l < r`，不是 `l <= r`。

**模板题**：167. 两数之和 II、15. 三数之和、11. 盛最多水的容器

## P03 滑动窗口

**识别信号**
- "连续子数组 / 子串"加上"最长 / 最短 / 个数"
- 窗口扩大时条件只会变差（或只会变好），满足单调性
- 暴力是枚举所有区间 O(n²)

**模板**（求最长的合法窗口）

```java
Map<Character, Integer> window = new HashMap<>();
int left = 0, best = 0;
for (int right = 0; right < s.length(); right++) {
    char c = s.charAt(right);
    window.merge(c, 1, Integer::sum);           // 1. 右边进窗口
    while (window.get(c) > 1) {                 // 2.【变化点】窗口不合法就收缩
        char d = s.charAt(left++);
        window.merge(d, -1, Integer::sum);
    }
    best = Math.max(best, right - left + 1);    // 3. 此时窗口合法，更新答案
}
return best;
```

**变化点**：求**最短**满足条件的窗口时，条件是"满足就收缩"，答案在 `while` 循环**里面**更新。

**易错点**：答案更新的位置（循环里还是循环外）；窗口长度是 `right - left + 1`。

**模板题**：3. 无重复字符的最长子串、209. 长度最小的子数组、76. 最小覆盖子串

## P04 前缀和

**识别信号**
- "子数组的和等于 / 能被整除 / 最大"，而且数组里**有负数**（这时滑动窗口不再单调）
- 多次查询区间和

**模板**（和为 k 的子数组个数）

```java
Map<Integer, Integer> count = new HashMap<>();
count.put(0, 1);                                // 空前缀：处理从下标 0 开始的子数组
int prefix = 0, ans = 0;
for (int x : nums) {
    prefix += x;
    ans += count.getOrDefault(prefix - k, 0);   // 【变化点】要找的旧前缀
    count.merge(prefix, 1, Integer::sum);
}
return ans;
```

**易错点**：忘记 `count.put(0, 1)`；区间和 `sum[i..j] = prefix[j + 1] - prefix[i]` 下标差一位。

**模板题**：560. 和为 K 的子数组、303. 区域和检索 - 数组不可变、238. 除自身以外数组的乘积

## P05 二分查找

**识别信号**
- 有序数组里找位置、找边界
- "最小的最大值""最大的最小值""至少 / 至多"——**二分答案**：答案越大越容易满足（或越难），可以二分
- 要求 O(log n)

**模板**（找第一个 ≥ target 的位置）

```java
int lo = 0, hi = nums.length;                   // 左闭右开 [lo, hi)
while (lo < hi) {
    int mid = lo + (hi - lo) / 2;               // 防止溢出
    if (nums[mid] < target) lo = mid + 1;       // 【变化点】判断条件（二分答案时换成 check(mid)）
    else hi = mid;
}
return lo;                                      // 不存在时等于 nums.length
```

**易错点**：区间开闭和循环条件要配套；`(lo + hi) / 2` 可能溢出；最后一个 ≤ target 的位置 = 第一个 > target 的位置 − 1。

**模板题**：704. 二分查找、35. 搜索插入位置、34. 在排序数组中查找元素的第一个和最后一个位置、875. 爱吃香蕉的珂珂

## P06 单调栈

**识别信号**
- "下一个更大 / 更小的元素""左边第一个比它小的"
- "柱状图""接雨水""温度"

**模板**（下一个更大元素）

```java
int[] ans = new int[n];
Arrays.fill(ans, -1);
Deque<Integer> stack = new ArrayDeque<>();      // 存下标；对应的值从栈底到栈顶递减
for (int i = 0; i < n; i++) {
    while (!stack.isEmpty() && nums[stack.peek()] < nums[i]) {   // 【变化点】比较方向
        ans[stack.pop()] = nums[i];             // 栈顶等到了它的"下一个更大"
    }
    stack.push(i);
}
return ans;
```

**易错点**：栈里存下标而不是值；严格小于还是小于等于决定了相等元素怎么处理。

**模板题**：739. 每日温度、496. 下一个更大元素 I、84. 柱状图中最大的矩形

## P07 链表

**识别信号**
- 输入是 `ListNode`
- "反转""合并""倒数第 k 个""环""中点"

**模板**（反转，以及哑节点 + 快慢指针）

```java
// 反转链表
ListNode prev = null, cur = head;
while (cur != null) {
    ListNode next = cur.next;                   // 先记住下一个
    cur.next = prev;                            // 掉头
    prev = cur;
    cur = next;
}
return prev;

// 删除倒数第 n 个节点
ListNode dummy = new ListNode(0, head);         // 哑节点：头节点也能统一处理
ListNode slow = dummy, fast = dummy;
for (int i = 0; i < n; i++) fast = fast.next;   // 【变化点】快指针先走几步
while (fast.next != null) {
    slow = slow.next;
    fast = fast.next;
}
slow.next = slow.next.next;
return dummy.next;
```

**易错点**：改 `next` 之前没保存下一个节点；空链表和单节点；快慢指针判环时 `fast != null && fast.next != null`。

**模板题**：206. 反转链表、21. 合并两个有序链表、19. 删除链表的倒数第 N 个结点、141. 环形链表

## P08 二叉树递归

**识别信号**
- 输入是 `TreeNode`，问深度、路径、是否对称、公共祖先等
- 整棵树的答案能由左右子树的答案拼出来

**模板**（递归三问：空节点返回什么？左右子树给我什么？我怎么拼出自己的答案？）

```java
int maxDepth(TreeNode root) {
    if (root == null) return 0;                 // 1. 空节点返回什么
    int left = maxDepth(root.left);             // 2. 相信递归：拿到左右子树的答案
    int right = maxDepth(root.right);
    return Math.max(left, right) + 1;           // 3.【变化点】用左右答案拼出自己的答案
}
```

**易错点**：想展开递归的每一层（不需要，相信函数定义即可）；全局答案和返回值不是一回事（如直径、最大路径和）。

**模板题**：104. 二叉树的最大深度、226. 翻转二叉树、236. 二叉树的最近公共祖先

## P09 BFS

BFS 即广度优先搜索。

**识别信号**
- "最少步数""最短路径"，且每一步的代价相同
- "层序遍历""一圈一圈扩散"
- 网格上的连通块

**模板**（网格最短步数）

```java
int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
Deque<int[]> queue = new ArrayDeque<>();
boolean[][] seen = new boolean[m][n];
queue.offer(new int[] {sr, sc});
seen[sr][sc] = true;
int steps = 0;
while (!queue.isEmpty()) {
    for (int size = queue.size(); size > 0; size--) {          // 一次处理一整层
        int[] cur = queue.poll();
        if (cur[0] == tr && cur[1] == tc) return steps;        // 【变化点】到达条件
        for (int[] d : dirs) {
            int r = cur[0] + d[0], c = cur[1] + d[1];
            if (r < 0 || r >= m || c < 0 || c >= n || seen[r][c] || grid[r][c] == 1) continue;
            seen[r][c] = true;                                 // 入队时就标记，避免重复入队
            queue.offer(new int[] {r, c});
        }
    }
    steps++;
}
return -1;
```

**易错点**：出队时才标记会导致重复入队；按层计数要先取 `queue.size()`。

**模板题**：102. 二叉树的层序遍历、200. 岛屿数量、994. 腐烂的橘子

## P10 回溯

**识别信号**
- "所有组合 / 排列 / 子集 / 方案"
- n 很小（≤ 20）
- 需要列出全部答案，而不是只求个数或最值

**模板**（做选择 → 递归 → 撤销选择）

```java
List<List<Integer>> ans = new ArrayList<>();
List<Integer> path = new ArrayList<>();

void backtrack(int[] nums, int start) {
    ans.add(new ArrayList<>(path));             // 【变化点】什么时候收集答案（子集：每个节点都收）
    for (int i = start; i < nums.length; i++) { // 【变化点】可选范围（组合用 start，排列用 used[]）
        path.add(nums[i]);                      // 做选择
        backtrack(nums, i + 1);
        path.remove(path.size() - 1);           // 撤销选择
    }
}
```

**易错点**：收集答案时直接 `ans.add(path)`，没有复制；去重要先排序，再跳过同一层的相同元素。

**模板题**：78. 子集、46. 全排列、39. 组合总和

## P11 动态规划

**识别信号**
- 求"最大 / 最小 / 方案数 / 能否"
- 当前选择影响后面，暴力递归里有大量重复的子问题
- "爬楼梯""打家劫舍""子序列""背包"

**模板**（四步：状态含义 → 转移方程 → 初始值 → 计算顺序）

```java
// 打家劫舍：dp[i] = 前 i 家能偷到的最大金额
int n = nums.length;
int[] dp = new int[n + 1];
dp[1] = nums[0];                                // 初始值（dp[0] = 0）
for (int i = 2; i <= n; i++) {
    dp[i] = Math.max(dp[i - 1], dp[i - 2] + nums[i - 1]);   // 【变化点】转移：不偷第 i 家 / 偷第 i 家
}
return dp[n];
```

**变化点**：两个序列的题（如最长公共子序列）用二维 `dp[i][j]`，表示前 i 个和前 j 个。

**易错点**：说不清 `dp[i]` 的含义就开始写；`dp` 下标和原数组下标差一位；初始值漏写。

**模板题**：70. 爬楼梯、198. 打家劫舍、300. 最长递增子序列、1143. 最长公共子序列

## P12 堆

Java 里用优先队列 `PriorityQueue` 实现。

**识别信号**
- "第 K 大 / 前 K 个 / 最小的 K 个"
- 不断取出当前最小 / 最大值（如合并 K 个有序链表）

**模板**（第 K 大）

```java
PriorityQueue<Integer> heap = new PriorityQueue<>();   // 小顶堆，堆顶是目前第 K 大
for (int x : nums) {
    heap.offer(x);
    if (heap.size() > k) heap.poll();           // 【变化点】超过 K 个就踢掉最小的
}
return heap.peek();
```

**易错点**：求第 K 大用小顶堆、第 K 小用大顶堆（`(a, b) -> b - a`，注意溢出时改用 `Integer.compare`）。

**模板题**：215. 数组中的第K个最大元素、347. 前 K 个高频元素、23. 合并 K 个升序链表

## P13 图与拓扑排序

**识别信号**
- "课程依赖""先后顺序""能否完成"——有向图里有没有环
- "连通""省份数量"

**模板**（拓扑排序判断能否完成）

```java
List<List<Integer>> graph = new ArrayList<>();
for (int i = 0; i < n; i++) graph.add(new ArrayList<>());
int[] indegree = new int[n];
for (int[] e : edges) {                          // 课程表：[a, b] 表示先修 b 再修 a
    graph.get(e[1]).add(e[0]);                   // 【变化点】边的方向
    indegree[e[0]]++;
}
Deque<Integer> queue = new ArrayDeque<>();
for (int i = 0; i < n; i++) if (indegree[i] == 0) queue.offer(i);
int done = 0;
while (!queue.isEmpty()) {
    int u = queue.poll();
    done++;
    for (int v : graph.get(u)) if (--indegree[v] == 0) queue.offer(v);
}
return done == n;                                // 有环时，环上的点入度永远减不到 0
```

**易错点**：边的方向建反；忘了入度为 0 的点要先全部入队。

**模板题**：207. 课程表、210. 课程表 II、547. 省份数量
````

- [ ] **Step 2: 写 teaching-examples.md**

`lib/skills/leo-lc-transcoder/references/teaching-examples.md`：

````markdown
# 讲题示范

讲课前必读。用户算法基础薄弱，目标是通过严格的算法面试，所以每一轮都要做到：只讲一个点、能手算、马上落术语。

## 一、好故事的六条标准

1. **动作一一对应**：故事里的每个动作，都对应代码里的一行。"右手往前抓一颗珠子"就是 `right++`。
2. **规模能手算**：数组不超过 6 个元素，字符串不超过 6 个字符。
3. **场景用户熟悉**：排队、找座位、翻书、挑水果，不用用户不熟的领域。
4. **讲完当场落术语**：故事讲到哪一步，就点出这一步的术语。
5. **能自然推出边界**：好故事能顺势问出"窗口空了怎么办""数组只有一个元素呢"。
6. **不夹带下一轮的内容**：这一轮只讲一个点。

反例："滑动窗口就像一个可以伸缩的框。"——没有对应到具体动作，推不出什么时候收缩。

正例："你用左右手在一串彩色珠子上各捏住一颗，两手之间的珠子不能有重复的颜色。右手每次往右多抓一颗；一旦出现重复颜色，左手就往右松开，直到没有重复为止。两手之间最多夹过几颗，就是答案。右手往右抓叫**扩张窗口**，左手往右松开叫**收缩窗口**。"

## 二、差的一轮 vs 好的一轮（3. 无重复字符的最长子串）

**差的一轮**：一条回复里先翻译题面，接着讲暴力解、滑动窗口思路、完整 Java 代码、复杂度分析，再附三道变体题。用户读完以为懂了，第二天全忘了。

**好的一轮**（只做模式 A 的第 1 步）：

> **3. 无重复字符的最长子串**（Medium）
>
> 给你一个字符串 `s`，找出其中不含重复字符的**最长子串**的长度。
>
> 示例：`s = "abcabcbb"` → `3`（最长的是 `"abc"`）
> 约束：`0 <= s.length <= 5 * 10^4`
>
> 先别急着想解法，试着回答两个问题：
> 1. `n` 最大是 5 万，按对照表，大概允许什么复杂度？
> 2. 最笨的办法是什么？
>
> 答不上来也没关系，说说你的直觉就行。

然后**停下来等用户回答**。

## 三、ASCII 手算练习示范

讲完窗口怎么动之后，给一道能手算的题：

```
s = "abba"

步骤1: [a] b  b  a        L=0 R=0  窗口 "a"
步骤2: [a  b] b  a        L=0 R=1  窗口 "ab"
步骤3:  a  b [b] a        ?
```

> 第 3 步右手抓到了第二个 `b`，窗口里出现了重复。左手要往右松开几颗？此时 L 等于多少？

## 四、纠错示范

用户回答："L 跳到 1。"

> 我们一步步算：右手抓到下标 2 的 `b` 时，窗口是 `a b b`（L=0），里面有两个 `b`。
> - 左手松开下标 0 的 `a` → 窗口 `b b`（L=1），还有两个 `b`，继续松
> - 左手松开下标 1 的 `b` → 窗口 `b`（L=2），没有重复了，停下
>
> 所以 L = 2。错在这条规则：**收缩要一直收到窗口重新合法为止**，不是只松开一颗。这就是模板里用 `while` 而不是 `if` 的原因。
>
> 面试说法："当右端加入的字符导致重复时，持续右移左边界，直到窗口内不再有重复字符。"

## 五、推翻简化示范

> 先修正上一轮的一个简化：上一轮我说"左手一颗一颗地松开"。其实可以用哈希表记下每个字符**上次出现的位置**，让左手直接跳过去，这样就不用一颗一颗地松开了。注意左手只能往右跳，不能往回跳，所以要写成 `left = Math.max(left, last.get(c) + 1)`。

## 六、收尾复述示范

> 请用术语把这道题讲一遍，30 秒以内，就像在面试。

检查四点，缺哪一点就补问哪一点：
1. **题型**：滑动窗口
2. **窗口始终满足的条件**：窗口内没有重复字符
3. **复杂度**：O(n)，因为每个字符最多进出窗口各一次；空间 O(字符集大小)
4. **边界**：空字符串返回 0

## 七、陌生题提示示范（模式 C，209. 长度最小的子数组）

用户卡住了。三级提示，每次只给一级，给完等用户再试：

1. **信号**："注意题面里的'连续子数组'和'长度最小'。"
2. **题型**："这是滑动窗口。和第 3 题比，这次是求最短。"
3. **模板**："先写出窗口模板。想一想：求最短时，答案应该在 `while` 循环里面更新，还是外面？"

把用了几级提示记进学习记录。

## 八、什么时候问"要不要看动画"

- 讲完核心思路、用户做完 ASCII 手算练习之后，问一次。
- 用户说"没看懂"时，先用动画重讲一遍，再换一个例子。
- 不要在第 1 步就放动画。用户还没自己想过，看动画只是在看热闹。
````

- [ ] **Step 3: 写 card-templates.md**

`lib/skills/leo-lc-transcoder/references/card-templates.md`：

````markdown
# 卡片与知识库格式

知识库根目录取自 config 的 `vault_root`。若 Obsidian vault 根目录有 `SCHEMA.md`，必须遵守：UTF-8 编码、新页面带 frontmatter、每页至少 2 个 `[[wikilink]]`、更新 index 和 log。新标签要先登记到 SCHEMA 的标签 taxonomy，本 skill 用到的标签是 `interview`、`algorithm`、`leetcode`。

## 知识库初始化

`vault_root` 下没有 `LEARNING.md` 时，创建以下骨架（`YYYY-MM-DD` 填今天的日期）：

```
LEARNING.md
00-Meta/index.md
00-Meta/log.md
00-Meta/复习队列.base
题型/
题目/
assets/
```

### LEARNING.md

```markdown
---
title: LeetCode 算法面试学习计划
type: learning-plan
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
---

# LeetCode 算法面试学习计划（唯一进度文件）

## 目标

通过严格的算法面试：算法环节 10～15 分钟，通常不能运行代码，面试官会追问复杂度和边界。

- 面试时间窗口：（初始化时询问用户后填写）
- 面试可用 = 掌握度 4 级：限时内一次提交就通过，并能讲清思路和复杂度。

## 题型掌握度

| 题型 | 已学题数 | 4 级题数 | 最近复习 | 备注 |
|---|---|---|---|---|
| [[P01_哈希表]] | 0 | 0 | - | |
| [[P02_双指针]] | 0 | 0 | - | |
| [[P03_滑动窗口]] | 0 | 0 | - | |
| [[P04_前缀和]] | 0 | 0 | - | |
| [[P05_二分查找]] | 0 | 0 | - | |
| [[P06_单调栈]] | 0 | 0 | - | |
| [[P07_链表]] | 0 | 0 | - | |
| [[P08_二叉树递归]] | 0 | 0 | - | |
| [[P09_BFS]] | 0 | 0 | - | |
| [[P10_回溯]] | 0 | 0 | - | |
| [[P11_动态规划]] | 0 | 0 | - | |
| [[P12_堆]] | 0 | 0 | - | |
| [[P13_图与拓扑排序]] | 0 | 0 | - | |

## 待办

（用户说暂缓的内容记在这里）

## 学习记录

| 日期 | 模式 | 题目 / 题型 | 结果 | 用时 | 提示级数 | 一次提交通过 |
|---|---|---|---|---|---|---|
```

### 00-Meta/index.md

```markdown
---
title: LC-Agent-Wiki 题型地图
type: moc
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
---

# 题型地图

建议学习顺序：P01 → P02 → P03 → P04 → P05 → P07 → P08 → P09 → P10 → P11 → P06 → P12 → P13。进度见 [[LEARNING]]。

## [[P01_哈希表]]
## [[P02_双指针]]
## [[P03_滑动窗口]]
## [[P04_前缀和]]
## [[P05_二分查找]]
## [[P06_单调栈]]
## [[P07_链表]]
## [[P08_二叉树递归]]
## [[P09_BFS]]
## [[P10_回溯]]
## [[P11_动态规划]]
## [[P12_堆]]
## [[P13_图与拓扑排序]]
```

每沉淀一道题，在对应题型下追加一行：`- [[LC0003_无重复字符的最长子串]] Medium · 一句话要点`。

### 00-Meta/log.md

```markdown
# 维护日志

## [YYYY-MM-DD] create | LC-Agent-Wiki 初始化
- 创建 LEARNING.md、00-Meta/index.md、00-Meta/log.md、00-Meta/复习队列.base
- 未改动其他笔记
```

之后每次沉淀追加一条：`## [YYYY-MM-DD] ingest | LC0003_无重复字符的最长子串`，下面列出创建或更新了哪些文件。

### 00-Meta/复习队列.base

`file.inFolder` 的路径相对于 Obsidian vault 根目录。下面以 vault 根目录为 `nightmare`、知识库为 `LC-Agent-Wiki` 为例：

```yaml
filters:
  and:
    - file.inFolder("LC-Agent-Wiki/题目")
views:
  - type: table
    name: 今天要复习
    filters:
      and:
        - 'date(next_review) <= today()'
    order:
      - file.name
      - difficulty
      - mastery
      - next_review
      - reviews
    sort:
      - property: next_review
        direction: ASC
  - type: table
    name: 全部题目
    order:
      - file.name
      - difficulty
      - patterns
      - mastery
      - next_review
```

## 题型卡：`题型/P{编号}_{题型名}.md`

```markdown
---
title: "P03 滑动窗口"
type: pattern
pattern_id: P03
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
problems: ["[[LC0003_无重复字符的最长子串]]"]
---

# P03 滑动窗口

> **一句话**：连续区间求最长或最短时，右边界一路扩张，窗口不合法就收缩左边界，每个元素最多进出窗口各一次，复杂度 O(n)。

## 0. 术语速查

| 术语 | 讲解时故事里的叫法 | 一句话意思 |
|---|---|---|
| 扩张窗口 | 右手往右抓一颗 | right++，新元素进入窗口 |

## 1. 识别信号

## 2. 解题四问落在本题型
- 第 3 问（瓶颈）：
- 第 4 问（怎么消除）：

## 3. Java 模板

（与 pattern-catalog.md 一致，可补充注释）

## 4. 模板变化点

| 题目 | 改动的地方 | 为什么 |
|---|---|---|

## 5. 演示

（ASCII 状态图）

[动画：3. 无重复字符的最长子串](../assets/LC0003-动画.html)

## 6. 易错点

## 7. 30 秒面试说法

## 8. 题目清单

| 题目 | 难度 | 掌握度 | 下次复习 |
|---|---|---|---|
| [[LC0003_无重复字符的最长子串]] | Medium | 2 | YYYY-MM-DD |
```

## 单题卡：`题目/LC{四位题号}_{中文名}.md`

```markdown
---
title: "3. 无重复字符的最长子串"
type: problem
site: leetcode-com
id: 3
slug: longest-substring-without-repeating-characters
url: https://leetcode.com/problems/longest-substring-without-repeating-characters/
difficulty: Medium
patterns: ["[[P03_滑动窗口]]"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
mastery: 2
next_review: YYYY-MM-DD
interval: 1
reviews: 0
last: { date: YYYY-MM-DD, hints: 0, minutes: 0, first_submit_ac: false }
---

# 3. 无重复字符的最长子串

> **一句话**：[[P03_滑动窗口]]，窗口内不能有重复字符；出现重复就收缩左边界。

## 0. 术语速查

| 术语 | 讲解时故事里的叫法 | 一句话意思 |
|---|---|---|

## 1. 题面

（中文题面）

![[LC0003-example.png]]

> [!note]- 英文原文
> （原文）

## 2. 解题四问
1. 数据规模：n ≤ 5×10⁴ → 允许 O(n log n) 以内
2. 暴力解：
3. 瓶颈：
4. 题型与信号：

## 3. 核心思路

（ASCII 状态图）

[动画](../assets/LC0003-动画.html)

## 4. 和模板的差异

## 5. 标准解法

来源：[题解标题](题解链接) · 作者

（Java 代码块）

### 进阶解法（可选）

## 6. 我的提交

## 7. 复杂度

## 8. 边界与易错点

## 9. 30 秒面试说法

## 10. 练习

| 题目 | 规范答案 | 易错点 |
|---|---|---|

## 11. 相关题
```

**复习字段说明**

- `mastery`：0 未学 / 1 看懂了 / 2 有提示能做出 / 3 独立做出 / 4 限时内一次提交就通过且讲得清
- `interval`：当前复习间隔档，取值 1 / 3 / 7 / 14 / 30（天）
- `next_review`：上次复习日期 + `interval`
- `last`：最近一次练习的情况：日期、提示级数、用时（分钟）、一次提交是否通过
````

- [ ] **Step 4: 检查题型编号一致**

Run: `grep -c "^## P[0-9][0-9] " lib/skills/leo-lc-transcoder/references/pattern-catalog.md && grep -o "P[0-9][0-9]_[^]]*" lib/skills/leo-lc-transcoder/references/card-templates.md | sort -u`
Expected: 第一条输出 `13`；第二条列出 `P01_哈希表` 到 `P13_图与拓扑排序`，与 pattern-catalog 的标题名称逐一对应（`P03_滑动窗口`、`P08_二叉树递归`、`P09_BFS`、`P13_图与拓扑排序` 等）。

- [ ] **Step 5: 提交**

```bash
git add lib/skills/leo-lc-transcoder/references
git commit -m "docs(leo-lc-transcoder): add pattern catalog, teaching examples and card templates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: SKILL.md、登记到托管目录、打包测试

**Files:**
- Create: `lib/skills/leo-lc-transcoder/SKILL.md`
- Modify: `lib/skills/managed-catalog.json`（在 `leo-ai-transcoder` 条目后插入）
- Test: `lib/skills/leo-lc-transcoder/tests/skill-package.test.mjs`

**Interfaces:**
- Consumes：所有前置任务产出的脚本命令、`T` 的视图 API、`references/` 文件名和题型编号；`lib/session-sync/skill-installer.mjs` 的 `SkillInstaller.installBaseSkill(dir, name)`
- Produces：可安装的托管 skill `leo-lc-transcoder`

- [ ] **Step 1: 写失败的打包测试**

`lib/skills/leo-lc-transcoder/tests/skill-package.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillInstaller } from "../../../session-sync/skill-installer.mjs";

const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), "utf8");

test("安装后包含完整的脚本、素材和参考资料", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lc-install-")), ".agents", "skills", "leo-lc-transcoder");
  SkillInstaller.installBaseSkill(dir, "leo-lc-transcoder");
  for (const rel of [
    "SKILL.md",
    "scripts/lc.mjs",
    "scripts/viz.mjs",
    "scripts/lib/config.mjs",
    "scripts/lib/args.mjs",
    "scripts/sites/leetcode-com/api.mjs",
    "scripts/sites/leetcode-com/cookie.mjs",
    "assets/T.java",
    "assets/player.html",
    "references/pattern-catalog.md",
    "references/teaching-examples.md",
    "references/card-templates.md",
  ]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `missing ${rel}`);
  }
});

test("SKILL.md 的 frontmatter 和关键约定", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /^---\nname: leo-lc-transcoder\ndescription: /);
  for (const cmd of ["lc config", "lc login", "lc search", "lc show", "lc run", "lc submit", "lc solutions", "viz.mjs"]) {
    assert.ok(skill.includes(cmd), `SKILL.md 缺少命令 ${cmd}`);
  }
  for (const rule of ["解题四问", "Easy 10 分钟", "Medium / Hard 15 分钟", "掌握度", "MOST_VOTES", "references/teaching-examples.md"]) {
    assert.ok(skill.includes(rule), `SKILL.md 缺少约定：${rule}`);
  }
});

test("托管目录里登记了本 skill", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "..", "managed-catalog.json"), "utf8"));
  const entry = catalog.skills.find((s) => s.name === "leo-lc-transcoder");
  assert.ok(entry, "catalog entry missing");
  assert.equal(entry.id, "leo-lc-transcoder");
  assert.equal(entry.managed, true);
});

test("题型目录有 P01～P13", () => {
  const catalog = read("references/pattern-catalog.md");
  for (let i = 1; i <= 13; i++) {
    assert.match(catalog, new RegExp(`^## P${String(i).padStart(2, "0")} `, "m"));
  }
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test lib/skills/leo-lc-transcoder/tests/skill-package.test.mjs`
Expected: FAIL，`No managed skill content found for leo-lc-transcoder` 或 `ENOENT ... SKILL.md`

- [ ] **Step 3: 写 SKILL.md**

`lib/skills/leo-lc-transcoder/SKILL.md`：

````markdown
---
name: leo-lc-transcoder
description: "LeetCode 算法面试教练，面向算法基础薄弱的 Java 工程师，目标是通过严格的算法面试。用「解题四问」和题型模板讲透单题，沉淀可举一反三的通用解题框架；脚本直连 leetcode.com 搜题、看题、运行、提交、获取高票 Java 题解，并生成可单步播放的算法动画；学习成果沉淀到 Obsidian（题型卡 ↔ 单题卡双链）并按间隔复习，供其他 agent 出题复习。当用户提到 LeetCode、力扣、刷题、算法题、题号、某类算法（滑动窗口、二分、动态规划、回溯等）、算法面试或复习算法时使用。"
---

# Leo LC Transcoder（算法面试教练）

## 目标与定位

目标只有一个：**通过严格的算法面试**。真实面试的算法环节一般 10～15 分钟，通常不能运行代码，面试官会追问复杂度和边界。

用户的痛点：刷完就忘；没见过的题做不出来；见过的题在面试时想不起来。所以本 skill 不追求刷题数量，而是训练两件事：

1. **识别题型**：从题面信号判断属于哪个题型；
2. **掌握模板**：每个题型有一个固定骨架，单题 = 模板 + 改动点。

以下 `lc` 指 `node <本 skill 目录>/scripts/lc.mjs`。

## 零、首次使用（强制）

1. 执行 `lc config`。若返回 `exists: false`，**暂停主流程**，向用户确认：
   > 👋 首次使用 leo-lc-transcoder，需要确认 3 项配置：
   > 1. 知识库目录（例如 `/Users/pa/project/OBDI/bg/nightmare/LC-Agent-Wiki`）
   > 2. JDK 目录，用于生成算法动画（默认探测 `~/.sdkman/candidates/java/current`）
   > 3. 显示语言（默认 `zh`）

   用户确认后执行 `lc config set vault_root=<路径> java_home=<路径> display_lang=zh`。
2. 若 `vault_root` 下没有 `LEARNING.md`，按 `references/card-templates.md` 的「知识库初始化」创建骨架，并询问用户的面试时间窗口，填入 LEARNING.md。
3. 本次用不到的配置项缺失时，不要打扰用户；用到时再问，并用 `lc config set` 写回。

**登录**：`lc login`。它通过 Chrome 上的 `Leo cookie.txt Locally` 扩展读取 leetcode.com 的 cookie：19527 端口上已有桥接服务就借用，没有就临时起一个，拿到 cookie 或超时（60 秒）后立即退出。其他命令遇到登录失效时，会自动重新登录一次。失败时按 `error.code` 告诉用户：

| error.code | 告诉用户 |
|---|---|
| `extension_timeout` | 打开 Chrome，确认 Leo cookie.txt Locally 扩展已启用 |
| `extension_unavailable` | 桥接服务在运行，但扩展离线：打开 Chrome |
| `not_logged_in` | 在 Chrome 上登录 leetcode.com |
| `port_busy` | 19527 端口被其他程序占用 |
| `auth` | 重新登录后仍被拒绝：在 Chrome 打开一次 leetcode.com 再试 |

## 一、脚本速查

所有命令输出 JSON：成功 `{ "ok": true, "data": ... }`，失败 `{ "ok": false, "error": { "code", "message" } }`。

| 命令 | 用途 |
|---|---|
| `lc config` / `lc config set k=v ...` | 查看 / 修改配置 |
| `lc login` | 获取并校验登录态 |
| `lc search <关键词或题号> [--limit 10]` | 搜题 |
| `lc show <题号或 slug> [--save-images <目录>]` | 题面 HTML、图片、示例用例、Java 模板、标签 |
| `lc run <题号> <Java 文件> [--input <文件>]` | 用示例用例（或自定义输入）运行 |
| `lc submit <题号> <Java 文件>` | 提交并等待判题结果 |
| `lc solutions <题号> [--top 5]` | 按票数（`MOST_VOTES`）取 Java 题解，附 `javaCode` |
| `node <skill>/scripts/viz.mjs <Demo.java> --out <html> [--title 标题]` | 生成算法动画 |

注意：
- `run` 的结果以 `passed` 为准。LeetCode 在答案错误时仍返回 "Accepted"，脚本已改写为 "Wrong Answer"。
- 连续 `run` / `submit` 太快会被限流，脚本会等待重试；不要并行调用。
- 提交的 Java 文件只放 LeetCode 模板里的 `class Solution`（和需要的辅助类），不要带 `main` 和 `T.frame`。

## 二、解题四问（每道题都走一遍）

1. **看数据规模**，判断允许的复杂度（对照表见 `references/pattern-catalog.md`）；
2. **暴力解**怎么做，复杂度多少；
3. 暴力解的**瓶颈**：哪里在重复计算；
4. 哪个**题型 / 数据结构**能消除重复，依据是题面里的什么信号。

讲题、测试、复习都围绕这四问。用户卡住时，先问他卡在第几问。

## 三、四种模式

### A. 学一道题（一轮一步，等用户回应再往下）

1. `lc show` 拿题面，按第五节翻译并展示图片和示例。先让用户试着回答四问的第 1、2 问，答不上来也没关系。
2. 讲暴力解，并结合数据规模说明为什么会超时。
3. 识别题型：点出题面信号对应哪个题型。知识库 `题型/` 下已有该题型卡时，先读卡片，点明"这题和你学过的 X 是同一类"，并用卡片里的模板来讲。
4. 讲核心思路：先讲生活故事，再当场点出术语；配一道 ASCII 手算练习（数组不超过 6 个元素）。然后问"要不要看动画走一遍"。
5. 套模板：贴出 `pattern-catalog.md` 里的模板，标出本题改动的行。
6. 写代码：掌握度低于 2 时，只让用户填写改动的那几行；之后完整地写。用户写完先 `lc run`，再 `lc submit`。失败时用失败用例一步步演算，指出错在哪条规则上。
7. 收尾：讲复杂度；请用户用术语复述一遍 30 秒面试说法；用一句话介绍一个变体；推荐一道同题型的下一题。
8. 询问是否沉淀（第八节）。

### B. 学一个题型

读 `pattern-catalog.md` 的对应条目 → 讲识别信号和模板 → 按"模板题 → 变体题 → 综合题"各选一道（优先用 catalog 里的模板题，不够再用 `lc search` 补），每道走模式 A，已经讲过的步骤压缩 → 产出题型卡。

### C. 陌生题测试（检验举一反三）

从用户学过的题型里，用 `lc search` 找一道知识库 `题目/` 下没有的题。只给题面，按严格面试规则让用户自己走四问。卡住时分三级提示，每次只给一级：

1. 信号："注意题面里的'连续子数组'"
2. 题型："这是滑动窗口"
3. 模板："先写出窗口模板，想想什么时候收缩"

记录用了几级提示。

### D. 复习

读知识库 `题目/*.md` 的 frontmatter，取 `next_review` 不晚于今天的题（或用户指定的题型）。只给题面，用户说出题型和思路后，再对照卡片，然后按严格规则写代码。复习完更新 frontmatter：

| 本次表现 | 新的 interval |
|---|---|
| 没用提示、限时内、一次提交通过 | 升一档：1 → 3 → 7 → 14 → 30（30 封顶） |
| 用了 1 级提示，或超时 | 保持不变 |
| 用了 2～3 级提示 | 降一档 |
| 完全想不起来 | 回到 1，并按模式 A 重讲 |

同时更新 `next_review`（今天 + interval）、`reviews`、`last`、`mastery`，并在 LEARNING.md 的学习记录里追加一行。

### 严格面试规则（模式 C、D）

- **限时：Easy 10 分钟，Medium / Hard 15 分钟**，超时记为未达标。开始和结束时各执行一次 `date` 计时。
- 写代码前，先口头讲出思路和复杂度。
- 写完先自己检查边界（空输入、单个元素、重复值、整数溢出），然后才允许 `run` / `submit`。
- 单独记录一次提交是否通过。

### 掌握度

| 级别 | 含义 |
|---|---|
| 0 | 未学 |
| 1 | 看懂了 |
| 2 | 有提示能做出 |
| 3 | 独立做出 |
| 4 | 限时内一次提交就通过，并能讲清思路和复杂度 |

**面试可用 = 4 级。**

## 四、讲解规则（继承 leo-ai-transcoder）

讲课前必读 `references/teaching-examples.md`。

- **每轮只讲一个点**，末尾配一道能手算的小练习，等用户作答。严禁在一条回复里同时塞入题解、代码、复杂度和变体。
- **先故事，后术语，术语当场点出**（例如"这一步叫收缩窗口"）。
- 例子小到能手算；明说本轮先不管什么；后面推翻前面的简化时要明说。
- 用户答错时，一步步演算出正确结果，指出错在哪条规则上，不只给答案。
- 每道练习确认对错后，把正确答案改写成一句"面试说法"。
- 用户说"没听懂"时，换一个更简单的例子，或者用动画重讲，不在原来的讲法上加码。

## 五、题面翻译与展示

- `display_lang` 为 `zh` 时把题面翻成中文，标题显示为"题号. 中文名"（如 `3. 无重复字符的最长子串`）。
- 示例的输入输出、约束条件（如 `1 <= n <= 10^5`）、代码、变量名、函数签名一律保留原文。
- 对话中直接用 `images` 里的 URL 展示图片（`![](url)`）；沉淀时用 `--save-images <vault_root>/assets` 下载到本地。

## 六、标准答案的选取

`lc solutions <题号> --top 5` 取按票数排序的 Java 题解，按以下顺序筛选：

1. 用的是该题型的通用模板（能和题型卡对上）；
2. 时间复杂度最优或接近最优；
3. 满足前两条后，选最好懂的：代码短、变量名清楚、没有花哨技巧。

如果高票解都很取巧，就选其中最好懂的作为标准解法，把最优但难懂的解法放进"进阶解法"，标注为可选。选定后先用 `lc run` 跑一遍示例，确认能通过再讲。卡片注明来源链接和作者；正文只摘代码和必要的思路，不整篇复制。

## 七、算法动画

时机：核心思路讲完、用户做完手算练习后问一次；或者用户说没看懂时。动画必须来自真实运行的代码，不手写动画。

1. 在临时目录写 `Demo.java`：**第一个顶层类带 `main`**，用题目示例构造输入并调用解法；解法类（`class Solution`）写在后面。在关键位置调用 `T.frame("中文说明", 视图...)`，行号会自动记录。
2. 执行 `node <skill>/scripts/viz.mjs Demo.java --out <vault_root>/assets/LC0003-动画.html --title "3. 无重复字符的最长子串"`。
3. 告诉用户用浏览器打开生成的文件。

视图 API：

| 写法 | 画出来的样子 |
|---|---|
| `T.arr("nums", nums, "L", l, "R", r)` | 数组，下方标出指针（标签和下标成对给出） |
| `T.range("s", s.toCharArray(), from, to, "L", l, "R", r)` | 数组，闭区间 `[from, to]` 高亮（滑动窗口） |
| `T.grid("dp", dp, i, j)` | 表格，高亮当前格（动态规划） |
| `T.tree("root", root, cur)` | 树。节点类要有 `val` 和 `left`/`right`；递归树或回溯树用 `val` 和 `kids`（List） |
| `T.stack("stack", deque)` | 栈，第一个元素画在最上面（`ArrayDeque.push` 的栈顶） |
| `T.vars("sum", sum, "best", best)` | 变量 |

用小输入（单次运行不超过 2000 帧）。卡片正文仍保留 ASCII 状态图，因为复习的 agent 只读文本。

## 八、知识沉淀

当用户明确说"懂了""明白了"，或完成一道题 / 一个题型时，在回复末尾主动询问：

> 💡 这道题的题型、模板和面试说法都过了一遍。要沉淀到知识库吗？
> 1. 沉淀到 Obsidian（单题卡 + 更新题型卡 + 安排复习）
> 2. 暂不沉淀，继续下一题

沉淀规则：

- **先草稿，后落盘**：先在临时目录写草稿给用户预览，确认后再写入知识库。
- **逐条核对，零遗漏**：写入前把对话里用户的每个提问、讲解中的每个要点逐条对照草稿，列出核对结果（已写 / 漏写已补 / 按用户要求不写）。
- **大白话和术语写在一起**：同一个概念只写一处，术语加粗随文出现；卡片开头放术语速查表。
- **卡片不收录用户原话**：练习写成"题目 / 规范答案 / 易错点"三栏；作答情况只概括记入 LEARNING.md。
- **尊重用户的取舍**：用户说暂缓的内容不写进卡片，记入 LEARNING.md 的待办。
- 遵守 vault 根目录 `SCHEMA.md`。

写入步骤（格式见 `references/card-templates.md`）：

1. 单题卡写到 `题目/LC{四位题号}_{中文名}.md`；
2. 题型卡已存在就更新题目清单和模板变化点表，不存在就新建 `题型/P{编号}_{题型名}.md`（编号用 pattern-catalog 的）；
3. 图片和动画 HTML 放到 `assets/`；
4. 复习字段：`mastery` 按本次表现填写，`interval: 1`，`next_review` = 今天 + 1 天；
5. 更新 LEARNING.md（掌握度表、学习记录）、`00-Meta/index.md`、`00-Meta/log.md`。

## 九、给复习 agent 的约定

其他 agent 帮用户复习时：先读 `LEARNING.md` 了解目标和进度 → 打开 `00-Meta/复习队列.base`，或扫描 `题目/*.md` 的 frontmatter → 按模式 D 执行 → 回写 frontmatter 和 LEARNING.md 的学习记录。除非用户要求，不要改动卡片正文里的标准解法。

## 十、维护与扩展

- **新增站点**：新建 `scripts/sites/<site>/`。其中 `api.mjs` 导出 `createApi(creds)`，返回 `whoami / search / show / run / submit / solutions`，返回结构与 leetcode-com 保持一致；`cookie.mjs` 导出 `login()`，返回 creds 对象。然后执行 `lc config set site=<site>`。
- **新增题型**：在 `references/pattern-catalog.md` 末尾按现有格式追加 `P14` 起的条目。
- **新的教学经验**：在 `references/teaching-examples.md` 追加正反对照。
- **接口变更**：先用浏览器抓包确认，再改 `api.mjs` 和 `tests/fixtures.mjs`，最后跑 `npm run test:leo-lc-transcoder`。
````

- [ ] **Step 4: 登记到 managed-catalog.json**

Run:

```bash
node -e '
const fs = require("fs");
const file = "lib/skills/managed-catalog.json";
const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
if (!catalog.skills.some((s) => s.name === "leo-lc-transcoder")) {
  const at = catalog.skills.findIndex((s) => s.name === "leo-ai-transcoder");
  catalog.skills.splice(at + 1, 0, {
    id: "leo-lc-transcoder",
    name: "leo-lc-transcoder",
    title: "Leo LC Transcoder (算法面试教练)",
    summary: "面向算法基础薄弱的 Java 工程师的 LeetCode 面试教练：用解题四问和题型模板讲透单题、沉淀可举一反三的解题框架，脚本直连 leetcode.com 搜题、运行、提交和获取高票题解，生成可单步播放的算法动画，学习成果沉淀到 Obsidian 并按间隔复习。",
    category: "career",
    categoryLabel: "职业与成长",
    icon: "🧩",
    featured: true,
    tags: ["leetcode", "algorithm", "interview", "java", "obsidian", "spaced-repetition"],
    requiresDaemon: false,
    promoted: true,
    managed: true,
  });
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
}'
git diff --stat lib/skills/managed-catalog.json
```

Expected: `git diff --stat` 只显示新增的行（约 20 行），没有其他条目被重新排版。如果其他行也有变化，说明原文件格式不是 2 空格缩进的 JSON：撤销改动，改为用 Edit 在 `leo-ai-transcoder` 条目的 `}` 之后手工插入同样的条目。

- [ ] **Step 5: 运行全部测试**

Run: `npm run test:leo-lc-transcoder`
Expected: PASS（config 3 + cookie 6 + api 15 + lc 8 + viz 5 + skill-package 4 = 41 tests）

- [ ] **Step 6: 提交**

```bash
git add lib/skills/leo-lc-transcoder/SKILL.md lib/skills/leo-lc-transcoder/tests/skill-package.test.mjs lib/skills/managed-catalog.json
git commit -m "feat(leo-lc-transcoder): add SKILL.md and register managed skill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 真实环境冒烟、安装、初始化知识库

这一步会访问真实的 leetcode.com，并写入用户的 `~/.agents/skills` 和 Obsidian 知识库，不进入自动测试。前提：Chrome 已打开，`Leo cookie.txt Locally` 扩展已启用，Chrome 上已登录 leetcode.com。每一步的结果都要如实记录；失败时停下来，告诉用户，不要绕过。

**Files:**
- 无代码改动（发现问题时回到对应任务修复，并补上测试）

- [ ] **Step 1: 配置**

```bash
node lib/skills/leo-lc-transcoder/scripts/lc.mjs config set vault_root=/Users/pa/project/OBDI/bg/nightmare/LC-Agent-Wiki java_home=$HOME/.sdkman/candidates/java/current display_lang=zh
```

Expected: `"ok": true`，返回的配置中三项都已写入。

- [ ] **Step 2: 登录，并确认进程退出、端口释放**

```bash
curl -s -m 2 http://127.0.0.1:19527/health; echo " <- 记录 19527 上是否已有桥接服务"
time node lib/skills/leo-lc-transcoder/scripts/lc.mjs login
lsof -nP -iTCP:19527 -sTCP:LISTEN || echo "19527 已释放"
ls -l ~/.shrimp/skills/leo-lc-transcoder/credentials.json
```

Expected: `login` 返回 `"ok": true` 和用户名，几秒内退出。如果之前 19527 上没有服务，最后应打印 "19527 已释放"。`credentials.json` 的权限为 `-rw-------`。

- [ ] **Step 3: 搜题、看题、下载图片**

```bash
node lib/skills/leo-lc-transcoder/scripts/lc.mjs search 3 --limit 3
node lib/skills/leo-lc-transcoder/scripts/lc.mjs show 206 --save-images ${TMPDIR:-/tmp}/lc-smoke/assets
ls ${TMPDIR:-/tmp}/lc-smoke/assets
```

Expected: 搜索结果的第一条是 `3 Longest Substring Without Repeating Characters`；`show` 返回 `images` 有 2 个，Java 模板以 `class Solution` 开头；目录下有 `LC0206-rev1ex1.jpg` 和 `LC0206-rev1ex2.jpg`。

- [ ] **Step 4: 运行和提交**

```bash
mkdir -p ${TMPDIR:-/tmp}/lc-smoke && cat > ${TMPDIR:-/tmp}/lc-smoke/TwoSum.java <<'EOF'
class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.Map<Integer, Integer> seen = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer j = seen.get(target - nums[i]);
            if (j != null) return new int[] {j, i};
            seen.put(nums[i], i);
        }
        return new int[0];
    }
}
EOF
node lib/skills/leo-lc-transcoder/scripts/lc.mjs run 1 ${TMPDIR:-/tmp}/lc-smoke/TwoSum.java
node lib/skills/leo-lc-transcoder/scripts/lc.mjs submit 1 ${TMPDIR:-/tmp}/lc-smoke/TwoSum.java
```

Expected: `run` 返回 `"passed": true`；`submit` 返回 `"status": "Accepted"`、`"passed": true`。

- [ ] **Step 5: 高票题解**

```bash
node lib/skills/leo-lc-transcoder/scripts/lc.mjs solutions 3 --top 3 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.ok, r.data.map(x=>[x.upvotes,x.author,x.javaCode.length,x.url]))})'
```

Expected: 3 条，票数从高到低，每条 `javaCode` 至少 1 段，`url` 能在浏览器打开。

- [ ] **Step 6: 动画**

按 Task 5 Step 7 的 Demo 生成 `${TMPDIR:-/tmp}/lc-viz-check/demo.html`（使用 config 里的 `java_home`），用浏览器打开，确认单步、播放和代码高亮都正常。

- [ ] **Step 7: 安装到各 agent**

```bash
node -e 'import("./lib/session-sync/skill-installer.mjs").then(({ SkillInstaller }) => console.log(SkillInstaller.install(null, "leo-lc-transcoder")))'
ls ~/.agents/skills/leo-lc-transcoder ~/.claude/skills/leo-lc-transcoder
```

Expected: 打印 `~/.agents/skills/leo-lc-transcoder/SKILL.md` 的路径；两个目录都能列出 `SKILL.md`、`scripts`、`assets`、`references`。

- [ ] **Step 8: 初始化知识库骨架**

按 SKILL.md 第零节第 2 步和 `references/card-templates.md` 的「知识库初始化」，在 `/Users/pa/project/OBDI/bg/nightmare/LC-Agent-Wiki` 下创建 `LEARNING.md`、`00-Meta/index.md`、`00-Meta/log.md`、`00-Meta/复习队列.base`，以及空目录 `题型/`、`题目/`、`assets/`。询问用户的面试时间窗口并填入 LEARNING.md。在 vault 根目录 `SCHEMA.md` 的标签 taxonomy 中追加 `algorithm` 和 `leetcode`（如果还没有）。在 vault 根目录 `index.md` 中加一行指向 `[[LC-Agent-Wiki/00-Meta/index|LC-Agent-Wiki 题型地图]]`。

Expected: 在 Obsidian 中打开 `复习队列.base` 不报错（此时为空）；LEARNING.md 中的 13 个题型链接显示为未创建（灰色），属正常现象。

- [ ] **Step 9: 收尾**

```bash
rm -rf ${TMPDIR:-/tmp}/lc-smoke ${TMPDIR:-/tmp}/lc-viz-check
npm run test:leo-lc-transcoder
git status --short
```

Expected: 测试全部通过；`git status` 干净（知识库在仓库外，不会出现在这里）。把每一步的结果汇报给用户，包括失败或跳过的步骤。
