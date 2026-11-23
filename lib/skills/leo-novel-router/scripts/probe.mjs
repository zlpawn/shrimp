import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readConfig, resolveHome, getSecretsPath, resolveWeReadApiKey, maskSecret } from "./config.mjs";

export const BUILTIN_PLATFORMS = {
  weread: {
    id: "weread",
    name: "微信读书 (WeRead)",
    domains: ["weread.qq.com"],
    mode: "hybrid-official-and-browser",
    adapterScript: "scripts/weread.mjs",
    requiresSkill: "leo-lantern",
    officialSkillRepo: "Tencent/WeChatReading",
    officialInstallCmd: "npx skills add Tencent/WeChatReading -g",
    officialSkillCandidates: ["weread-skills", "WeChatReading", "weread-official", "weread"],
  },
};

export const EXTERNAL_PLATFORM_CANDIDATES = {
  dedao: {
    id: "dedao",
    name: "得到 (Dedao)",
    domains: ["dedao.cn", "www.dedao.cn"],
    mode: "external-skill-or-fallback",
    officialSkillCandidates: ["dedao", "dedao-reader", "dedao-official"],
  },
  douban: {
    id: "douban",
    name: "豆瓣阅读",
    domains: ["read.douban.com"],
    mode: "external-skill-or-fallback",
    officialSkillCandidates: ["douban-read", "douban-reading"],
  },
  kindle: {
    id: "kindle",
    name: "Kindle / Amazon",
    domains: ["read.amazon.com", "read.amazon.cn"],
    mode: "external-skill-or-fallback",
    officialSkillCandidates: ["kindle", "kindle-reader"],
  },
};

/**
 * Probe all standard skill discovery locations for a given skill name.
 */
export function probeSkillLocations(skillName, cwd = process.cwd(), home = os.homedir()) {
  const candidates = [
    { scope: "workspace-agents", path: path.join(cwd, ".agents", "skills", skillName, "SKILL.md") },
    { scope: "workspace-lib", path: path.join(cwd, "lib", "skills", skillName, "SKILL.md") },
    { scope: "global-agents", path: path.join(home, ".agents", "skills", skillName, "SKILL.md") },
    { scope: "global-gemini", path: path.join(home, ".gemini", "config", "skills", skillName, "SKILL.md") },
    { scope: "global-claude", path: path.join(home, ".claude", "skills", skillName, "SKILL.md") },
  ];

  const found = candidates.filter((c) => fs.existsSync(c.path));
  return {
    installed: found.length > 0,
    primaryPath: found[0]?.path || null,
    locations: found,
  };
}

/**
 * Locate leo-lantern CLI entrypoint (global PATH or skill directory).
 */
export function locateLanternCli(cwd = process.cwd(), home = os.homedir()) {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(finder, ["leo-lantern"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first) {
      return { found: true, mode: "bin", command: first, argsPrefix: [] };
    }
  } catch {
    // fallback to script path lookup
  }

  const skillInfo = probeSkillLocations("leo-lantern", cwd, home);
  for (const loc of skillInfo.locations) {
    const cliEntry = path.join(path.dirname(loc.path), "scripts", "cli", "index.mjs");
    if (fs.existsSync(cliEntry)) {
      return { found: true, mode: "node", command: process.execPath, argsPrefix: [cliEntry], scriptPath: cliEntry };
    }
  }

  return { found: false, mode: null, command: null, argsPrefix: [] };
}

/**
 * Check if leo-lantern bridge server is currently reachable on 127.0.0.1:19527.
 */
export async function checkLanternHealth(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch("http://127.0.0.1:19527/health", { signal: controller.signal });
    if (!resp.ok) return { bridge: false, extensionOnline: false };
    const data = await resp.json();
    return {
      bridge: Boolean(data?.ok || data?.bridge),
      extensionOnline: Boolean(data?.extensionOnline),
      raw: data,
    };
  } catch {
    return { bridge: false, extensionOnline: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Match a URL or platform keyword to a known platform descriptor.
 */
export function matchPlatform(input = "", config = readConfig()) {
  const raw = String(input || "").trim();
  const lower = raw.toLowerCase();

  const all = { ...BUILTIN_PLATFORMS, ...EXTERNAL_PLATFORM_CANDIDATES };
  if (config.external_skills && typeof config.external_skills === "object") {
    for (const [id, entry] of Object.entries(config.external_skills)) {
      all[id] = {
        id,
        name: entry.name || id,
        domains: Array.isArray(entry.domains) ? entry.domains : [],
        mode: "external-skill-registered",
        officialSkillCandidates: [entry.skillName || id],
      };
    }
  }

  for (const platform of Object.values(all)) {
    if (lower === platform.id || lower.includes(platform.id)) {
      return platform;
    }
    if (platform.domains.some((d) => lower.includes(d))) {
      return platform;
    }
  }
  return null;
}

/**
 * Probe environment readiness for leo-novel-router.
 */
export async function probeAll({ cwd = process.cwd(), home = os.homedir(), checkBridge = true } = {}) {
  const config = readConfig();
  const lanternSkill = probeSkillLocations("leo-lantern", cwd, home);
  const lanternCli = locateLanternCli(cwd, home);
  const lanternHealth = checkBridge ? await checkLanternHealth() : null;

  const platforms = {};
  for (const [id, p] of Object.entries({ ...BUILTIN_PLATFORMS, ...EXTERNAL_PLATFORM_CANDIDATES })) {
    const externalMatches = (p.officialSkillCandidates || [])
      .map((s) => ({ skillName: s, ...probeSkillLocations(s, cwd, home) }))
      .filter((m) => m.installed);

    platforms[id] = {
      id,
      name: p.name,
      mode: p.mode,
      domains: p.domains,
      externalSkillInstalled: externalMatches.length > 0,
      externalSkillsFound: externalMatches,
      officialSkillRepo: p.officialSkillRepo || null,
      officialInstallCmd: p.officialInstallCmd || null,
      builtinReady:
        p.mode === "builtin-browser" || p.mode === "hybrid-official-and-browser"
          ? lanternCli.found
          : false,
    };
  }

  const weReadCreds = resolveWeReadApiKey();

  return {
    router: "leo-novel-router",
    outputDir: resolveHome(config.output_dir),
    credentials: {
      secretsPath: getSecretsPath(),
      wereadApiKeyConfigured: Boolean(weReadCreds.apiKey),
      wereadApiKeySource: weReadCreds.source,
      wereadApiKeyMasked: maskSecret(weReadCreds.apiKey),
    },
    lantern: {
      skillInstalled: lanternSkill.installed,
      cliFound: lanternCli.found,
      cli: lanternCli,
      health: lanternHealth,
    },
    platforms,
  };
}

async function main() {
  const report = await probeAll({ checkBridge: !process.argv.includes("--no-bridge") });
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
