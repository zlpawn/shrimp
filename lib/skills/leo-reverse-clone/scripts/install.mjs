import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { getCommandEnv, findExecutable, parseVersionToken } from "./probe.mjs";
import { readConfig, saveConfig, resolveHome } from "./config.mjs";
import { resolveProxyInfo, requestWithProxy } from "./proxy.mjs";

const VALID_ENGINES = new Set(["rea", "craft-anything", "all"]);
const VALID_SCOPES = new Set(["all", "engine", "skill"]);

function runStrict(cmd, args = [], opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    stdio: opts.stdio || ["ignore", "pipe", "pipe"],
    timeout: opts.timeoutMs || 180_000,
    env: getCommandEnv(opts.proxyInfo || null),
  });
}

function getSkillsRoots(homeDir = os.homedir()) {
  return {
    agentsRoot: path.join(homeDir, ".agents", "skills"),
    geminiRoot: path.join(homeDir, ".gemini", "config", "skills"),
  };
}

/**
 * Link or copy installed skill directory into ~/.gemini/config/skills/<skillName> if parent exists.
 */
function syncSkillLink(skillName, targetSkillDir, homeDir = os.homedir()) {
  const { geminiRoot } = getSkillsRoots(homeDir);
  if (!fs.existsSync(path.dirname(geminiRoot))) {
    return null;
  }
  fs.mkdirSync(geminiRoot, { recursive: true });
  const linkPath = path.join(geminiRoot, skillName);

  try {
    if (fs.lstatSync(linkPath)) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  } catch {
    // linkPath does not exist yet
  }

  try {
    fs.symlinkSync(targetSkillDir, linkPath, process.platform === "win32" ? "junction" : "dir");
    return { mode: "symlink", path: linkPath };
  } catch {
    fs.cpSync(targetSkillDir, linkPath, { recursive: true });
    return { mode: "copy", path: linkPath };
  }
}

async function downloadText(url, proxyUrl = "", timeoutMs = 20_000) {
  const resp = await requestWithProxy(url, {
    method: "GET",
    proxyUrl,
    timeoutMs,
    headers: { "User-Agent": "leo-reverse-clone-installer" },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} 下载失败: ${url}`);
  }
  return resp.text();
}

async function downloadFile(url, destPath, proxyInfo = null, timeoutMs = 300_000) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const proxyUrl = proxyInfo?.url || "";
  const curl = findExecutable("curl");
  if (curl) {
    const curlArgs = [
      "-fLsS",
      "--retry",
      "3",
      "--retry-delay",
      "1",
      "--connect-timeout",
      "20",
      "--max-time",
      String(Math.max(30, Math.ceil(timeoutMs / 1000))),
      "-A",
      "leo-reverse-clone-installer",
      "-o",
      destPath,
    ];
    if (proxyUrl) {
      curlArgs.push("--proxy", proxyUrl);
    } else if (proxyInfo?.source === "disabled" || proxyInfo?.source === "config-disabled") {
      curlArgs.push("--noproxy", "*");
    }
    curlArgs.push(url);
    runStrict(curl, curlArgs, { timeoutMs: timeoutMs + 5000, proxyInfo });
    return fs.statSync(destPath).size;
  }

  const resp = await requestWithProxy(url, {
    method: "GET",
    proxyUrl,
    timeoutMs,
    headers: { "User-Agent": "leo-reverse-clone-installer" },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} 下载失败: ${url}`);
  }
  fs.writeFileSync(destPath, resp.buffer);
  return resp.buffer.length;
}

export function selectCraftAssetName(version, platform = process.platform, arch = process.arch) {
  const v = String(version).replace(/^v/, "");
  if (platform === "darwin") {
    return {
      filename: `craft-anything-cli-${v}-macos-universal.zip`,
      archiveKind: "zip",
      binaryName: "craft-anything-cli",
    };
  }
  if (platform === "win32") {
    const winArch = arch === "arm64" ? "arm64" : arch === "ia32" ? "x86" : "x64";
    return {
      filename: `craft-anything-${v}-windows-${winArch}-portable.zip`,
      archiveKind: "zip",
      binaryName: "craft-anything-cli.exe",
    };
  }
  const linuxArch = arch === "arm64" ? "aarch64" : "x86_64";
  return {
    filename: `craft-anything-${v}-linux-${linuxArch}.tar.gz`,
    archiveKind: "tar.gz",
    binaryName: "craft-anything-cli",
  };
}

function findFileRecursive(dir, targetName, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === targetName) return full;
    if (entry.isDirectory()) {
      const hit = findFileRecursive(full, targetName, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function extractArchive(archivePath, destDir, archiveKind) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archiveKind === "zip") {
    if (process.platform === "darwin") {
      runStrict("ditto", ["-x", "-k", archivePath, destDir]);
      return;
    }
    if (process.platform === "win32") {
      runStrict("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ]);
      return;
    }
    runStrict("unzip", ["-o", archivePath, "-d", destDir]);
    return;
  }
  runStrict("tar", ["-xzf", archivePath, "-C", destDir]);
}

export function buildInstallPlan({ engine = "all", scope = "all", homeDir = os.homedir(), fromLocal = null } = {}) {
  const targets = engine === "all" ? ["rea", "craft-anything"] : [engine];
  const { agentsRoot, geminiRoot } = getSkillsRoots(homeDir);
  const actions = [];

  for (const t of targets) {
    if (t === "rea") {
      if (scope === "all" || scope === "engine") {
        actions.push({
          engine: "rea",
          kind: "engine",
          description: "安装 rea-agents 全局 npm 包（不执行 rea setup，不修改任何 Agent 全局 MCP 配置）",
          command: "npm install --global rea-agents",
        });
      }
      if (scope === "all" || scope === "skill") {
        actions.push({
          engine: "rea",
          kind: "skill",
          description: "同步官方 reverse-engineer-anything Skill（含 references）到 ~/.agents/skills/reverse-engineer-anything",
          destination: path.join(agentsRoot, "reverse-engineer-anything"),
          geminiLink: path.join(geminiRoot, "reverse-engineer-anything"),
          fromLocal,
        });
      }
    }

    if (t === "craft-anything") {
      if (scope === "all" || scope === "engine") {
        const binName = process.platform === "win32" ? "craft-anything-cli.exe" : "craft-anything-cli";
        actions.push({
          engine: "craft-anything",
          kind: "engine",
          description: "从 GitHub Releases 免编译下载纯命令行 craft-anything-cli 二进制（不装 .dmg、不装 Cargo）",
          destination: path.join(homeDir, ".local", "bin", binName),
        });
      }
      if (scope === "all" || scope === "skill") {
        actions.push({
          engine: "craft-anything",
          kind: "skill",
          description: "同步官方 craft-anything Skill 到 ~/.agents/skills/craft-anything/SKILL.md（不运行 setup，不改全局 MCP）",
          destination: path.join(agentsRoot, "craft-anything", "SKILL.md"),
          geminiLink: path.join(geminiRoot, "craft-anything"),
          fromLocal,
        });
      }
    }
  }

  return {
    dryRun: true,
    note: "不会修改任何 Agent 全局 MCP 配置文件；需传入 --yes 才会实际执行下载与安装。",
    actions,
  };
}

async function installReaEngine({ proxyInfo = null } = {}) {
  const npm = findExecutable("npm");
  if (!npm) {
    throw new Error("未找到 npm，请先安装 Node.js (22.23.4+ / 24.22.1+ / 26.12.1+)");
  }
  runStrict(npm, ["install", "--global", "rea-agents"], { timeoutMs: 300_000, proxyInfo });
  const reaBin = findExecutable("rea") || findExecutable("rea-agents");
  if (reaBin) {
    saveConfig({ rea_bin: reaBin });
  }
  return { installed: true, bin: reaBin };
}

async function installReaSkill({ homeDir = os.homedir(), fromLocal = null, proxyInfo = null } = {}) {
  const { agentsRoot } = getSkillsRoots(homeDir);
  const destDir = path.join(agentsRoot, "reverse-engineer-anything");
  fs.mkdirSync(agentsRoot, { recursive: true });

  // Priority 1: explicit local checkout
  const candidateSources = [];
  if (fromLocal) {
    const absLocal = resolveHome(fromLocal);
    candidateSources.push(path.join(absLocal, ".agents", "skills", "reverse-engineer-anything"));
    candidateSources.push(path.join(absLocal, "skills", "reverse-engineer-anything"));
  }

  // Priority 2: installed npm global package
  const npm = findExecutable("npm");
  if (npm) {
    try {
      const globalRoot = runStrict(npm, ["root", "-g"], { timeoutMs: 10_000, proxyInfo }).trim();
      candidateSources.push(path.join(globalRoot, "rea-agents", "skills", "reverse-engineer-anything"));
      candidateSources.push(path.join(globalRoot, "rea-agents", ".agents", "skills", "reverse-engineer-anything"));
    } catch {
      // ignore npm root failure
    }
  }

  const localHit = candidateSources.find((dir) => fs.existsSync(path.join(dir, "SKILL.md")));
  if (localHit) {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.cpSync(localHit, destDir, { recursive: true });
    const link = syncSkillLink("reverse-engineer-anything", destDir, homeDir);
    return { installed: true, source: localHit, destDir, geminiLink: link };
  }

  // Priority 3: official GitHub raw fallback (SKILL.md)
  const rawUrl =
    "https://raw.githubusercontent.com/morluto/rea/main/.agents/skills/reverse-engineer-anything/SKILL.md";
  const content = await downloadText(rawUrl, proxyInfo?.url || "");
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, "SKILL.md"), content, { encoding: "utf-8" });
  const link = syncSkillLink("reverse-engineer-anything", destDir, homeDir);
  return { installed: true, source: rawUrl, destDir, geminiLink: link };
}

async function installCraftEngine({ homeDir = os.homedir(), proxyInfo = null } = {}) {
  const proxyUrl = proxyInfo?.url || "";
  const releaseResp = await requestWithProxy("https://api.github.com/repos/storytold/craft-anything/releases/latest", {
    method: "GET",
    proxyUrl,
    timeoutMs: 25_000,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "leo-reverse-clone-installer",
    },
  });
  if (!releaseResp.ok) {
    throw new Error(`查询 craft-anything 最新版本失败: HTTP ${releaseResp.status}`);
  }
  const release = releaseResp.json();
  const tag = release?.tag_name;
  const ver = parseVersionToken(tag);
  if (!tag || !ver) {
    throw new Error("无法解析 craft-anything 最新 Release 版本号");
  }

  const assetInfo = selectCraftAssetName(ver);
  const matchingAsset = (release.assets || []).find((a) => a.name === assetInfo.filename);
  const downloadUrl =
    matchingAsset?.browser_download_url ||
    `https://github.com/storytold/craft-anything/releases/download/${tag}/${assetInfo.filename}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-reverse-clone-craft-"));
  try {
    const archivePath = path.join(tmpDir, assetInfo.filename);
    const extractDir = path.join(tmpDir, "unpacked");
    await downloadFile(downloadUrl, archivePath, proxyInfo);
    extractArchive(archivePath, extractDir, assetInfo.archiveKind);

    const extractedBin = findFileRecursive(extractDir, assetInfo.binaryName);
    if (!extractedBin) {
      throw new Error(`解压包 ${assetInfo.filename} 中未找到 ${assetInfo.binaryName}`);
    }

    const binDir = path.join(homeDir, ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const targetBin = path.join(binDir, assetInfo.binaryName);
    fs.copyFileSync(extractedBin, targetBin);
    if (process.platform !== "win32") {
      fs.chmodSync(targetBin, 0o755);
    }

    saveConfig({ craft_bin: targetBin });
    return { installed: true, version: ver, downloadUrl, bin: targetBin };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function installCraftSkill({ homeDir = os.homedir(), fromLocal = null, proxyInfo = null } = {}) {
  const { agentsRoot } = getSkillsRoots(homeDir);
  const destDir = path.join(agentsRoot, "craft-anything");
  fs.mkdirSync(destDir, { recursive: true });

  let content = null;
  let source = null;

  if (fromLocal) {
    const localSkill = path.join(resolveHome(fromLocal), "crates", "setup", "src", "skill.md");
    if (fs.existsSync(localSkill)) {
      content = fs.readFileSync(localSkill, "utf-8");
      source = localSkill;
    }
  }

  if (!content) {
    const rawUrl = "https://raw.githubusercontent.com/storytold/craft-anything/main/crates/setup/src/skill.md";
    content = await downloadText(rawUrl, proxyInfo?.url || "");
    source = rawUrl;
  }

  const destFile = path.join(destDir, "SKILL.md");
  fs.writeFileSync(destFile, content, { encoding: "utf-8" });
  const link = syncSkillLink("craft-anything", destDir, homeDir);
  return { installed: true, source, destFile, geminiLink: link };
}

export async function runInstall({
  engine = "all",
  scope = "all",
  confirm = false,
  homeDir = os.homedir(),
  fromLocal = null,
  cliProxy = "",
  noProxy = false,
} = {}) {
  if (!VALID_ENGINES.has(engine)) {
    throw new Error(`无效的 engine: ${engine}（可选: rea | craft-anything | all）`);
  }
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(`无效的 scope: ${scope}（可选: all | engine | skill）`);
  }

  const cfg = readConfig();
  const proxyInfo = resolveProxyInfo({ cliProxy, noProxy, configProxy: cfg.proxy || "", env: process.env });
  const plan = buildInstallPlan({ engine, scope, homeDir, fromLocal });
  plan.proxy = proxyInfo;
  if (!confirm) {
    return plan;
  }

  const targets = engine === "all" ? ["rea", "craft-anything"] : [engine];
  const executed = [];

  for (const t of targets) {
    if (t === "rea") {
      if (scope === "all" || scope === "engine") {
        executed.push({ engine: "rea", kind: "engine", ...(await installReaEngine({ proxyInfo })) });
      }
      if (scope === "all" || scope === "skill") {
        executed.push({ engine: "rea", kind: "skill", ...(await installReaSkill({ homeDir, fromLocal, proxyInfo })) });
      }
    }
    if (t === "craft-anything") {
      if (scope === "all" || scope === "engine") {
        executed.push({ engine: "craft-anything", kind: "engine", ...(await installCraftEngine({ homeDir, proxyInfo })) });
      }
      if (scope === "all" || scope === "skill") {
        executed.push({ engine: "craft-anything", kind: "skill", ...(await installCraftSkill({ homeDir, fromLocal, proxyInfo })) });
      }
    }
  }

  return {
    dryRun: false,
    proxy: proxyInfo,
    note: "安装完成（全程未修改任何 Agent 全局 MCP 配置）。",
    executed,
  };
}

function getArgValue(args, flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
leo-reverse-clone JIT 按需下载与安装工具（不修改全局 MCP 配置）

用法:
  node install.mjs --engine <rea|craft-anything|all> [--only <all|engine|skill>] [--from-local <仓库路径>] [--yes]

说明:
  - 不带 --yes 时仅输出安装计划（dry-run），不会写入磁盘；
  - 仅在用户明确同意后传入 --yes 执行实际下载。
`);
    process.exit(0);
  }

  const engine = getArgValue(args, "--engine", "all");
  const scope = getArgValue(args, "--only", "all");
  const fromLocal = getArgValue(args, "--from-local");
  const cliProxy = getArgValue(args, "--proxy", "");
  const noProxy = args.includes("--no-proxy");
  const confirm = args.includes("--yes") || args.includes("--confirm");

  try {
    const out = await runInstall({ engine, scope, confirm, fromLocal, cliProxy, noProxy });
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}
