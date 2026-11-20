import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export const ENGINES = {
  docling: {
    id: "docling",
    skillName: "docling",
    cliName: "docling",
    pypiPackage: "docling",
    installCliCmd: "uv tool install docling",
    upgradeCliCmd: "uv tool upgrade docling",
    uvxPrefix: "uvx --from docling docling",
    skillInstallHint:
      "安装 docling 后可从包内 docling/.agents/skills/docling 复制到 ~/.agents/skills/docling 并软链到 ~/.gemini/config/skills/docling",
  },
  markitdown: {
    id: "markitdown",
    skillName: "markitdown",
    cliName: "markitdown",
    pypiPackage: "markitdown",
    installCliCmd: 'uv tool install "markitdown[all]"',
    upgradeCliCmd: "uv tool upgrade markitdown",
    uvxPrefix: 'uvx "markitdown[all]"',
    skillInstallHint:
      "社区 Skill 参考: https://github.com/raccioly/markitdown-skill （也可不装独立 Skill，直接由 leo-md-router 按 engines-catalog.md 调度）",
  },
};

function getCommandEnv() {
  const home = os.homedir();
  const extraBins = [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
  ];
  const sep = process.platform === "win32" ? ";" : ":";
  const currentPath = process.env.PATH || "";
  return {
    ...process.env,
    PATH: [...extraBins, currentPath].filter(Boolean).join(sep),
  };
}

function runCmd(cmd, args = [], timeoutMs = 8000) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      env: getCommandEnv(),
    });
    return { ok: true, output: out.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function findExecutable(binName) {
  const finder = process.platform === "win32" ? "where" : "which";
  const res = runCmd(finder, [binName], 3000);
  if (!res.ok || !res.output) return null;
  return res.output.split(/\r?\n/)[0].trim();
}

export function probeSkillLocations(skillName, cwd = process.cwd()) {
  const home = os.homedir();
  const candidates = [
    { scope: "global-agents", path: path.join(home, ".agents", "skills", skillName, "SKILL.md") },
    { scope: "global-gemini", path: path.join(home, ".gemini", "config", "skills", skillName, "SKILL.md") },
    { scope: "global-claude", path: path.join(home, ".claude", "skills", skillName, "SKILL.md") },
    { scope: "workspace-agents", path: path.join(cwd, ".agents", "skills", skillName, "SKILL.md") },
    { scope: "workspace-lib", path: path.join(cwd, "lib", "skills", skillName, "SKILL.md") },
  ];

  const found = candidates.filter((c) => fs.existsSync(c.path));
  return {
    installed: found.length > 0,
    locations: found,
  };
}

function parseUvToolVersions() {
  const res = runCmd("uv", ["tool", "list"], 5000);
  if (!res.ok) return {};
  const map = {};
  for (const line of res.output.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9._-]+)\s+v([0-9][^\s]*)/);
    if (match) {
      map[match[1].toLowerCase()] = match[2];
    }
  }
  return map;
}

function parseVersionToken(raw) {
  if (!raw) return null;
  const match = raw.match(/(\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]*)?)/);
  return match ? match[1] : null;
}

export function compareVersions(a, b) {
  if (!a || !b) return null;
  const toNums = (v) =>
    v
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((n) => Number.parseInt(n, 10));
  const pa = toNums(a);
  const pb = toNums(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

async function fetchLatestPypiVersion(pkg, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.info?.version || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAll({ checkUpdates = false, cwd = process.cwd() } = {}) {
  const uvPath = findExecutable("uv");
  const uvxPath = findExecutable("uvx");
  const uvTools = uvPath ? parseUvToolVersions() : {};

  const results = {};
  for (const [key, engine] of Object.entries(ENGINES)) {
    const skill = probeSkillLocations(engine.skillName, cwd);
    const cliPath = findExecutable(engine.cliName);
    let cliVersion = uvTools[engine.pypiPackage.toLowerCase()] || null;
    if (!cliVersion && cliPath) {
      const verRes = runCmd(cliPath, ["--version"], 6000);
      if (verRes.ok) cliVersion = parseVersionToken(verRes.output);
    }

    let latestVersion = null;
    let updateAvailable = null;
    if (checkUpdates && cliVersion) {
      latestVersion = await fetchLatestPypiVersion(engine.pypiPackage);
      if (latestVersion) {
        const cmp = compareVersions(cliVersion, latestVersion);
        updateAvailable = cmp !== null ? cmp < 0 : null;
      }
    }

    results[key] = {
      id: engine.id,
      skill,
      cli: {
        installed: Boolean(cliPath || uvTools[engine.pypiPackage.toLowerCase()]),
        path: cliPath,
        version: cliVersion,
        latestVersion,
        updateAvailable,
      },
      commands: {
        installCli: engine.installCliCmd,
        upgradeCli: engine.upgradeCliCmd,
        uvxFallback: engine.uvxPrefix,
        skillInstallHint: engine.skillInstallHint,
      },
    };
  }

  return {
    tooling: {
      uv: uvPath,
      uvx: uvxPath,
    },
    engines: results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
leo-md-router 环境与版本探测工具

用法:
  node probe.mjs                   探测本地 Skill 与 CLI 安装状态
  node probe.mjs --check-updates   同时联网检查 PyPI 是否有新版本可升级
`);
    process.exit(0);
  }

  const checkUpdates = args.includes("--check-updates");
  const report = await probeAll({ checkUpdates });
  console.log(JSON.stringify(report, null, 2));
}
