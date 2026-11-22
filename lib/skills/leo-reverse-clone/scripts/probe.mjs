import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { readConfig, resolveHome } from "./config.mjs";
import { resolveProxyInfo, buildProxyEnv, requestWithProxy } from "./proxy.mjs";

export const ENGINES = {
  rea: {
    id: "rea",
    displayName: "REA (rea-agents)",
    skillName: "reverse-engineer-anything",
    cliNames: ["rea", "rea-agents"],
    npmPackage: "rea-agents",
    githubRepo: "morluto/rea",
    mcpTransport: "streamable-http",
    installEngineCmd: "node scripts/install.mjs --engine rea --only engine --yes",
    installSkillCmd: "node scripts/install.mjs --engine rea --only skill --yes",
    installAllCmd: "node scripts/install.mjs --engine rea --yes",
    fallbackHint: "npx -y rea-agents@latest mcp --http",
  },
  "craft-anything": {
    id: "craft-anything",
    displayName: "Craft Anything (craft-anything-cli)",
    skillName: "craft-anything",
    cliNames: ["craft-anything-cli"],
    npmPackage: null,
    githubRepo: "storytold/craft-anything",
    mcpTransport: "stdio-broker",
    installEngineCmd: "node scripts/install.mjs --engine craft-anything --only engine --yes",
    installSkillCmd: "node scripts/install.mjs --engine craft-anything --only skill --yes",
    installAllCmd: "node scripts/install.mjs --engine craft-anything --yes",
    fallbackHint: "从 GitHub Releases 免编译下载纯 craft-anything-cli 二进制（无需 .dmg / Cargo）",
  },
};

export function getCommandEnv(proxyInfo = null) {
  const home = os.homedir();
  const extraBins = [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".npm-global", "bin"),
  ];
  const sep = process.platform === "win32" ? ";" : ":";
  const currentPath = process.env.PATH || "";
  const cfg = readConfig();
  const resolvedProxy = proxyInfo || resolveProxyInfo({ configProxy: cfg.proxy || "", env: process.env });
  return buildProxyEnv(
    {
      ...process.env,
      PATH: [...extraBins, currentPath].filter(Boolean).join(sep),
    },
    resolvedProxy,
  );
}

function runCmd(cmd, args = [], timeoutMs = 8000) {
  const res = spawnSync(cmd, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    env: getCommandEnv(),
  });
  const combined = [res.stdout, res.stderr].map((s) => (s ? String(s).trim() : "")).filter(Boolean).join("\n");
  if (res.error || res.status !== 0) {
    return { ok: false, output: combined, error: res.error ? res.error.message : `exit ${res.status}` };
  }
  return { ok: true, output: combined };
}

export function findExecutable(binName) {
  if (!binName) return null;
  if (path.isAbsolute(binName) || binName.includes("/") || binName.includes("\\")) {
    const resolved = resolveHome(binName);
    return fs.existsSync(resolved) ? resolved : null;
  }
  const finder = process.platform === "win32" ? "where" : "which";
  const res = runCmd(finder, [binName], 3000);
  if (!res.ok || !res.output) return null;
  return res.output.split(/\r?\n/)[0].trim();
}

export function probeSkillLocations(skillName, cwd = process.cwd(), homeDir = os.homedir()) {
  const candidates = [
    { scope: "global-agents", path: path.join(homeDir, ".agents", "skills", skillName, "SKILL.md") },
    { scope: "global-gemini", path: path.join(homeDir, ".gemini", "config", "skills", skillName, "SKILL.md") },
    { scope: "global-claude", path: path.join(homeDir, ".claude", "skills", skillName, "SKILL.md") },
    { scope: "global-codex", path: path.join(homeDir, ".codex", "skills", skillName, "SKILL.md") },
    { scope: "workspace-agents", path: path.join(cwd, ".agents", "skills", skillName, "SKILL.md") },
    { scope: "workspace-lib", path: path.join(cwd, "lib", "skills", skillName, "SKILL.md") },
  ];

  const found = candidates.filter((c) => fs.existsSync(c.path));
  return {
    installed: found.length > 0,
    primaryPath: found[0]?.path || null,
    locations: found,
  };
}

export function parseVersionToken(raw) {
  if (!raw) return null;
  const match = String(raw).match(/v?(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.-]+)?)/);
  return match ? match[1] : null;
}

export function compareVersions(a, b) {
  if (!a || !b) return null;
  const toNums = (v) =>
    String(v)
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

async function fetchLatestNpmVersion(pkg, proxyUrl = "", timeoutMs = 8000) {
  try {
    const resp = await requestWithProxy(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      method: "GET",
      proxyUrl,
      timeoutMs,
      headers: { Accept: "application/json", "User-Agent": "leo-reverse-clone-probe" },
    });
    if (!resp.ok) return null;
    const data = resp.json();
    return data?.version || null;
  } catch {
    return null;
  }
}

async function fetchLatestGithubRelease(repo, proxyUrl = "", timeoutMs = 8000) {
  try {
    const resp = await requestWithProxy(`https://api.github.com/repos/${repo}/releases/latest`, {
      method: "GET",
      proxyUrl,
      timeoutMs,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "leo-reverse-clone-probe",
      },
    });
    if (!resp.ok) return null;
    const data = resp.json();
    return parseVersionToken(data?.tag_name || data?.name);
  } catch {
    return null;
  }
}

function probeOptionalTooling() {
  const uv = findExecutable("uv");
  const node = findExecutable("node");
  const npm = findExecutable("npm");
  const npx = findExecutable("npx");
  const java = findExecutable("java");
  let javaVersion = null;
  if (java) {
    const jv = runCmd(java, ["-version"], 4000);
    javaVersion = parseVersionToken(jv.output);
  }
  const jadx = findExecutable("jadx");
  const jadxMcpJar = process.env.REA_JADX_MCP_JAR && fs.existsSync(process.env.REA_JADX_MCP_JAR)
    ? process.env.REA_JADX_MCP_JAR
    : null;
  const ghidra = findExecutable("analyzeHeadless") || (process.env.GHIDRA_INSTALL_DIR && fs.existsSync(process.env.GHIDRA_INSTALL_DIR) ? process.env.GHIDRA_INSTALL_DIR : null);
  const adb = findExecutable("adb");

  return {
    uv,
    node,
    nodeVersion: process.versions.node,
    npm,
    npx,
    java,
    javaVersion,
    jadx,
    reaJadxMcpJar: jadxMcpJar,
    ghidra,
    adb,
  };
}

export async function probeAll({ checkUpdates = false, cwd = process.cwd(), homeDir = os.homedir(), cliProxy = "", noProxy = false } = {}) {
  const cfg = readConfig();
  const proxy = resolveProxyInfo({ cliProxy, noProxy, configProxy: cfg.proxy || "", env: process.env });
  const tooling = probeOptionalTooling();
  const results = {};

  for (const [key, engine] of Object.entries(ENGINES)) {
    const skill = probeSkillLocations(engine.skillName, cwd, homeDir);

    const configuredBin = key === "rea" ? cfg.rea_bin : cfg.craft_bin;
    let binPath = configuredBin ? findExecutable(configuredBin) : null;
    if (!binPath) {
      for (const name of engine.cliNames) {
        binPath = findExecutable(name);
        if (binPath) break;
      }
    }

    let version = null;
    if (binPath) {
      const verRes = runCmd(binPath, ["--version"], 6000);
      if (verRes.ok || verRes.output) {
        version = parseVersionToken(verRes.output);
      }
    }

    let latestVersion = null;
    let updateAvailable = null;
    if (checkUpdates) {
      latestVersion = engine.npmPackage
        ? await fetchLatestNpmVersion(engine.npmPackage, proxy.url)
        : await fetchLatestGithubRelease(engine.githubRepo, proxy.url);
      if (version && latestVersion) {
        const cmp = compareVersions(version, latestVersion);
        updateAvailable = cmp !== null ? cmp < 0 : null;
      }
    }

    const engineInstalled = Boolean(binPath);
    results[key] = {
      id: engine.id,
      displayName: engine.displayName,
      mcpTransport: engine.mcpTransport,
      ready: engineInstalled && skill.installed,
      needsEngine: !engineInstalled,
      needsSkill: !skill.installed,
      skill,
      engine: {
        installed: engineInstalled,
        path: binPath,
        version,
        latestVersion,
        updateAvailable,
      },
      commands: {
        installAll: engine.installAllCmd,
        installEngine: engine.installEngineCmd,
        installSkill: engine.installSkillCmd,
        fallbackHint: engine.fallbackHint,
      },
    };
  }

  return {
    platform: process.platform,
    arch: process.arch,
    proxy,
    tooling,
    engines: results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
leo-reverse-clone 运行期环境与官方 Skill 探测工具

用法:
  node probe.mjs                   探测 rea / craft-anything 引擎程序、官方 Skill 与可选依赖
  node probe.mjs --check-updates   同时联网检查 npm / GitHub Releases 最新版本
`);
    process.exit(0);
  }

  const checkUpdates = args.includes("--check-updates");
  const noProxy = args.includes("--no-proxy");
  const proxyIdx = args.indexOf("--proxy");
  const cliProxy = proxyIdx !== -1 && args[proxyIdx + 1] ? args[proxyIdx + 1] : "";
  const report = await probeAll({ checkUpdates, cliProxy, noProxy });
  console.log(JSON.stringify(report, null, 2));
}
