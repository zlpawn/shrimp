import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  fetchBufferViaSystemProxy,
  fetchJsonViaSystemProxy,
  resolveUserLocalProxy,
} from "./proxy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SHRIMP_ROOT = path.resolve(__dirname, "../..");
export const DEFAULT_BIN_OFM_DIR = path.join(DEFAULT_SHRIMP_ROOT, "bin", "ofm");

export const OFM_GITHUB_OWNER = "Ebony-Vinyl";
export const OFM_GITHUB_REPO = "dsh-our-free-model";
export const OFM_GITHUB_BRANCH = "main";

const BASE_STANDALONE_FILES = [
  "LICENSE",
  "scripts/standalone-third-party.txt",
  "packages/standalone/package.json",
  "packages/standalone/cli.mjs",
  "packages/standalone/service.mjs",
  "packages/standalone/management.mjs",
  "packages/standalone/desktop-update.mjs",
  "packages/standalone/login-terminal.mjs",
  "packages/standalone/open-external.mjs",
  "packages/standalone/eac.mjs",
  "packages/standalone/workbench.mjs",
  "packages/standalone/client-terminal.mjs",
  "packages/standalone/providers.mjs",
  "packages/standalone/library.mjs",
  "packages/standalone/routing.mjs",
  "packages/standalone/feedback.mjs",
  ...["business", "contracts", "credentials", "images", "runtime", "worker"].map(
    (name) => `packages/standalone/channels/${name}.mjs`,
  ),
  "packages/standalone/web/index.html",
  "packages/standalone/web/assets.json",
  ...[
    "adapter", "aggregate", "anthropic", "catalog", "channel", "combos",
    "deferred-response", "disclaimer", "eac", "eac-login", "eac-user", "effort",
    "egress", "engine-payload", "failure", "forward", "gemini", "http",
    "image-pricing", "kilo", "local-optimize", "loopback-fetch", "magpie-engine",
    "magpie-models", "magpie-policy", "messages", "model-test", "open-external",
    "probe", "recovery", "store", "stream", "subscriptions",
    "subscription-completion", "subscription-adapter", "token-saver", "trust",
    "upstream", "vault", "vault-data", "vault-anchor",
  ].map((name) => `src/${name}.js`),
  ...["completion", "runtime", "stats"].map((name) => `src/core/${name}.js`),
  "src/core.js",
  "src/bun-fetch.js",
  "src/o2a.js",
  "src/extensions.js",
  "src/plugins.js",
  "src/semver.js",
  "src/providers/index.js",
  "src/providers/registry.json",
  "src/route/classify.js",
  ...["index", "inject", "prompts"].map((name) => `src/token-saver/${name}.js`),
  ...["index", "constants", "autodetect", "applyFilter", "hitLine", "registry"].map(
    (name) => `src/token-saver/rtk/${name}.js`,
  ),
  ...[
    "buildOutput", "dedupLog", "find", "gitDiff", "gitLog", "gitStatus", "grep",
    "ls", "readNumbered", "searchList", "smartTruncate", "tree",
  ].map((name) => `src/token-saver/rtk/filters/${name}.js`),
  "vendor/channel-pack/qoder-auth-wasm.wasm",
  "vendor/channel-pack/LICENSE",
  "vendor/channel-pack/NOTICE.md",
];

/**
 * Pure Node.js POSIX ustar / pax / GNU LongLink .tar.gz parser.
 * Extracts archive entries into a Map<relativePathWithoutRootPrefix, Buffer>.
 */
export function extractTarGzToMap(tarGzBuffer) {
  const tar = zlib.gunzipSync(tarGzBuffer);
  const files = new Map();
  let offset = 0;
  let paxPath = null;
  let gnuLongPath = null;

  const readCString = (buf, start, len) => {
    const slice = buf.subarray(start, start + len);
    const nul = slice.indexOf(0);
    return (nul >= 0 ? slice.subarray(0, nul) : slice).toString("utf8");
  };

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // Empty block (end of archive)
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const name = readCString(header, 0, 100);
    const sizeOctal = readCString(header, 124, 12).trim();
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const typeFlag = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const prefix = readCString(header, 345, 155);

    offset += 512;
    const content = tar.subarray(offset, offset + size);
    const paddedSize = Math.ceil(size / 512) * 512;
    offset += paddedSize;

    if (typeFlag === "x" || typeFlag === "g") {
      // PAX extended header
      const paxText = content.toString("utf8");
      for (const line of paxText.split("\n")) {
        const sp = line.indexOf(" ");
        if (sp > 0) {
          const kv = line.slice(sp + 1);
          if (kv.startsWith("path=")) {
            paxPath = kv.slice(5);
          }
        }
      }
      continue;
    }

    if (typeFlag === "L") {
      // GNU LongLink
      gnuLongPath = readCString(content, 0, content.length);
      continue;
    }

    let fullPath = paxPath || gnuLongPath || (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    gnuLongPath = null;

    if (typeFlag === "0" || typeFlag === "\0") {
      fullPath = fullPath.replace(/\\/g, "/").replace(/^\/+/, "");
      const slashIdx = fullPath.indexOf("/");
      const relPath = slashIdx >= 0 ? fullPath.slice(slashIdx + 1) : fullPath;
      if (relPath && !relPath.includes("..")) {
        files.set(relPath, Buffer.from(content));
      }
    }
  }

  return files;
}

export function isWantedStandalonePath(relPath, extraWebAssets = []) {
  if (BASE_STANDALONE_FILES.includes(relPath)) return true;
  if (extraWebAssets.some((name) => relPath === `packages/standalone/web/${name}`)) return true;
  if (
    relPath.startsWith("src/") &&
    !relPath.startsWith("src/engine-parts/") &&
    !relPath.startsWith("src/o2a/") &&
    /\.(?:js|mjs|json)$/.test(relPath)
  ) {
    return true;
  }
  if (
    relPath.startsWith("packages/standalone/") &&
    !relPath.startsWith("packages/standalone/frontend/") &&
    /\.(?:mjs|js|json|html|css)$/.test(relPath) &&
    relPath !== "packages/standalone/package-lock.json" &&
    relPath !== "packages/standalone/tsconfig.json" &&
    relPath !== "packages/standalone/vite.config.mjs" &&
    relPath !== "packages/standalone/components.json"
  ) {
    return true;
  }
  return false;
}

export function selectStandaloneRuntimeFiles(archiveFiles) {
  const assetsRaw = archiveFiles.get("packages/standalone/web/assets.json");
  if (!assetsRaw) {
    throw new Error("归档包缺少 packages/standalone/web/assets.json");
  }
  const assets = JSON.parse(assetsRaw.toString("utf8"));
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error("packages/standalone/web/assets.json 内容无效");
  }

  const selected = new Map();
  for (const relPath of [...archiveFiles.keys()].sort()) {
    if (isWantedStandalonePath(relPath, assets)) {
      selected.set(relPath, archiveFiles.get(relPath));
    }
  }
  for (const reqFile of [
    "packages/standalone/cli.mjs",
    "packages/standalone/service.mjs",
    "packages/standalone/package.json",
  ]) {
    if (!selected.has(reqFile)) {
      throw new Error(`归档包缺少核心入口文件: ${reqFile}`);
    }
  }
  return selected;
}

export function getInstalledOfmInfo(binOfmDir = DEFAULT_BIN_OFM_DIR) {
  const cliPath = path.join(binOfmDir, "packages", "standalone", "cli.mjs");
  const pkgPath = path.join(binOfmDir, "packages", "standalone", "package.json");
  const syncMetaPath = path.join(binOfmDir, ".ofm-sync.json");

  const installed = fs.existsSync(cliPath) && fs.existsSync(pkgPath);
  if (!installed) {
    return {
      installed: false,
      binOfmDir,
      cliPath,
      version: null,
      coreVersion: null,
      commitSha: null,
      syncedAt: null,
    };
  }

  let pkg = {};
  let syncMeta = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {}
  try {
    if (fs.existsSync(syncMetaPath)) {
      syncMeta = JSON.parse(fs.readFileSync(syncMetaPath, "utf8"));
    }
  } catch {}

  return {
    installed: true,
    binOfmDir,
    cliPath,
    version: pkg.version || syncMeta.version || "unknown",
    coreVersion: syncMeta.coreVersion || pkg.version || "unknown",
    commitSha: syncMeta.commitSha || null,
    commitDate: syncMeta.commitDate || null,
    syncedAt: syncMeta.syncedAt || null,
    source: syncMeta.source || "bundled",
  };
}

export async function fetchUpstreamOfmMeta({
  owner = OFM_GITHUB_OWNER,
  repo = OFM_GITHUB_REPO,
  branch = OFM_GITHUB_BRANCH,
  proxyUrl,
} = {}) {
  const resolvedProxy = proxyUrl !== undefined
    ? { url: proxyUrl, source: "explicit" }
    : resolveUserLocalProxy();

  let commitSha = null;
  let commitDate = null;
  let commitMessage = null;

  try {
    const commitRes = await fetchJsonViaSystemProxy(
      `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`,
      {
        timeoutMs: 15_000,
        proxyUrl: resolvedProxy.url,
        headers: { Accept: "application/vnd.github.v3+json" },
      },
    );
    commitSha = commitRes.data?.sha || null;
    commitDate = commitRes.data?.commit?.committer?.date || null;
    commitMessage = String(commitRes.data?.commit?.message || "").split("\n")[0].trim() || null;
  } catch {
    // GitHub API rate limit fallback: continue with raw.githubusercontent.com
  }

  const ref = commitSha || branch;
  const [standalonePkgRes, rootPkgRes] = await Promise.all([
    fetchJsonViaSystemProxy(
      `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/packages/standalone/package.json`,
      { timeoutMs: 15_000, proxyUrl: resolvedProxy.url },
    ),
    fetchJsonViaSystemProxy(
      `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/package.json`,
      { timeoutMs: 15_000, proxyUrl: resolvedProxy.url },
    ).catch(() => ({ data: {} })),
  ]);

  return {
    owner,
    repo,
    branch,
    version: standalonePkgRes.data?.version || "unknown",
    coreVersion: rootPkgRes.data?.version || standalonePkgRes.data?.version || "unknown",
    commitSha,
    commitDate,
    commitMessage,
    proxy: resolvedProxy,
  };
}

export async function checkOfmUpdate({
  binOfmDir = DEFAULT_BIN_OFM_DIR,
  proxyUrl,
} = {}) {
  const local = getInstalledOfmInfo(binOfmDir);
  const remote = await fetchUpstreamOfmMeta({ proxyUrl });

  let hasUpdate = false;
  if (!local.installed) {
    hasUpdate = true;
  } else if (remote.commitSha && local.commitSha) {
    hasUpdate = remote.commitSha !== local.commitSha;
  } else if (remote.version !== local.version || remote.coreVersion !== local.coreVersion) {
    hasUpdate = true;
  } else if (!local.commitSha && remote.commitSha) {
    hasUpdate = true;
  }

  return {
    ok: true,
    installed: local.installed,
    local,
    remote,
    hasUpdate,
    proxy: remote.proxy,
  };
}

export function writeStandaloneFilesToDirectory({
  selectedFiles,
  targetDir,
  meta,
}) {
  const parentDir = path.dirname(targetDir);
  fs.mkdirSync(parentDir, { recursive: true });
  const stageDir = path.join(parentDir, `.ofm-stage-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  const backupDir = path.join(parentDir, `.ofm-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);

  try {
    fs.mkdirSync(stageDir, { recursive: true });
    for (const [relFile, bytes] of selectedFiles.entries()) {
      const outFile = relFile === "scripts/standalone-third-party.txt" ? "THIRD_PARTY_NOTICES.txt" : relFile;
      const absPath = path.join(stageDir, outFile);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, bytes, { mode: 0o644 });
    }

    const standalonePkg = JSON.parse(
      selectedFiles.get("packages/standalone/package.json").toString("utf8"),
    );

    // Ensure root package.json sets type: "module" so src/*.js loads as ESM
    fs.writeFileSync(
      path.join(stageDir, "package.json"),
      JSON.stringify(
        {
          name: standalonePkg.name || "our-free-model-standalone",
          version: standalonePkg.version || "2.8.2",
          private: true,
          type: "module",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const syncRecord = {
      version: standalonePkg.version || meta?.version || "unknown",
      coreVersion: meta?.coreVersion || standalonePkg.version || "unknown",
      commitSha: meta?.commitSha || null,
      commitDate: meta?.commitDate || null,
      commitMessage: meta?.commitMessage || null,
      syncedAt: new Date().toISOString(),
      source: meta?.source || "github",
      filesCount: selectedFiles.size,
    };
    fs.writeFileSync(
      path.join(stageDir, ".ofm-sync.json"),
      JSON.stringify(syncRecord, null, 2) + "\n",
      "utf8",
    );

    // Atomic swap with rollback
    const hadTarget = fs.existsSync(targetDir);
    if (hadTarget) {
      fs.renameSync(targetDir, backupDir);
    }
    try {
      fs.renameSync(stageDir, targetDir);
    } catch (swapErr) {
      if (hadTarget && fs.existsSync(backupDir) && !fs.existsSync(targetDir)) {
        try {
          fs.renameSync(backupDir, targetDir);
        } catch {}
      }
      throw swapErr;
    }
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
    return syncRecord;
  } finally {
    if (fs.existsSync(stageDir)) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }
}

async function fetchStandaloneFilesViaRawTree({
  owner,
  repo,
  ref,
  proxyUrl,
}) {
  const [treeRes, assetsRes] = await Promise.all([
    fetchJsonViaSystemProxy(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
      {
        timeoutMs: 20_000,
        proxyUrl,
        headers: { Accept: "application/vnd.github.v3+json" },
      },
    ),
    fetchJsonViaSystemProxy(
      `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/packages/standalone/web/assets.json`,
      { timeoutMs: 15_000, proxyUrl },
    ),
  ]);

  const tree = Array.isArray(treeRes.data?.tree) ? treeRes.data.tree : null;
  if (!tree || treeRes.data?.truncated) {
    throw new Error("Git tree unavailable or truncated");
  }
  const assets = Array.isArray(assetsRes.data) ? assetsRes.data : [];
  if (assets.length === 0) {
    throw new Error("packages/standalone/web/assets.json empty");
  }

  const targetPaths = tree
    .filter((entry) => entry.type === "blob" && isWantedStandalonePath(entry.path, assets))
    .map((entry) => entry.path)
    .sort();

  const selected = new Map();
  const concurrency = 10;
  let cursor = 0;

  async function worker() {
    while (cursor < targetPaths.length) {
      const idx = cursor++;
      const relPath = targetPaths[idx];
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${relPath}`;
      const res = await fetchBufferViaSystemProxy(rawUrl, {
        timeoutMs: 30_000,
        proxyUrl,
      });
      if (!res.ok) {
        throw new Error(`下载文件失败 ${relPath} (HTTP ${res.status})`);
      }
      selected.set(relPath, res.buffer);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targetPaths.length) }, () => worker()));
  return selected;
}

export async function updateOfmCoreFromGithub({
  binOfmDir = DEFAULT_BIN_OFM_DIR,
  owner = OFM_GITHUB_OWNER,
  repo = OFM_GITHUB_REPO,
  branch = OFM_GITHUB_BRANCH,
  proxyUrl,
  onRestartIfRunning,
} = {}) {
  const remoteMeta = await fetchUpstreamOfmMeta({ owner, repo, branch, proxyUrl });
  const ref = remoteMeta.commitSha || branch;

  let selected;
  try {
    selected = await fetchStandaloneFilesViaRawTree({
      owner,
      repo,
      ref,
      proxyUrl: remoteMeta.proxy.url,
    });
  } catch {
    const tarballUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
    const tarRes = await fetchBufferViaSystemProxy(tarballUrl, {
      timeoutMs: 180_000,
      maxBytes: 256 * 1024 * 1024,
      proxyUrl: remoteMeta.proxy.url,
    });
    if (!tarRes.ok) {
      throw new Error(`下载 OFM GitHub 归档包失败 (HTTP ${tarRes.status})`);
    }
    const archiveMap = extractTarGzToMap(tarRes.buffer);
    selected = selectStandaloneRuntimeFiles(archiveMap);
  }

  const syncRecord = writeStandaloneFilesToDirectory({
    selectedFiles: selected,
    targetDir: binOfmDir,
    meta: {
      ...remoteMeta,
      source: `github:${owner}/${repo}@${ref.slice(0, 10)}`,
    },
  });

  let restarted = false;
  if (typeof onRestartIfRunning === "function") {
    restarted = Boolean(await onRestartIfRunning());
  }

  return {
    ok: true,
    updated: true,
    restarted,
    sync: syncRecord,
    proxy: remoteMeta.proxy,
  };
}
