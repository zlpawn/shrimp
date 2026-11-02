#!/usr/bin/env node
// leo-lc-transcoder 统一入口：node lc.mjs <命令> ...，结果以 JSON 输出到 stdout。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { configExists, readConfig, writeConfig, readCredentials, writeCredentials } from "./lib/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "用法：lc.mjs config [set k=v ...] | login | search <关键词或题号> | show <题号> [--save-images 目录] | run <题号> <文件> [--input 文件] | submit <题号> <文件> | solutions <题号> [--top N] | history [题号] [--since YYYY-MM-DD]";

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
    const commands = ["login", "search", "show", "run", "submit", "solutions", "history"];
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
      case "history": {
        // 以本轮开始日期为界：之前的提交只作参考
        const since = opts.since ? String(opts.since) : readConfig().study_start;
        if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw fail("usage", `日期格式应为 YYYY-MM-DD：${since}`);
        data = await withApi(site, (api) => (args[0] ? api.history(args[0], since) : api.overview(since)));
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
