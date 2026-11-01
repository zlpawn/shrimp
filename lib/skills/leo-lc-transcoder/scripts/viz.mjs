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
