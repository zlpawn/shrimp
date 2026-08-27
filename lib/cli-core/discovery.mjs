import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expandDirs, CliSourceConfig } from "./source-config.mjs";

const execFileP = promisify(execFile);
const isWindows = process.platform === "win32";
const WIN_EXE_EXTS = new Set([".exe", ".cmd", ".bat"]);

// Names that are clearly not CLIs -- uninstallers, setup wrappers, OS
// built-ins, installers. These are skipped so the list only shows real
// command-line tools the user can actually invoke.
const IGNORE_NAME_RE =
  /^(uninst|unins\d*|setup|install|installer|msiexec|regsvr32|rundll32|wscript|cscript|curl\.ca|update|updater|helper|crashpad|crashreporter|elevation|deprecated|remove)/i;

// Exact names (case-insensitive) that are NOT standalone CLIs the user would
// invoke directly. These are GUI apps, GUI launchers, or helper/shim scripts
// shipped inside other installers (e.g. the headless Java launcher javaw, the
// Git GUI tools, nvm environment-setup .bat, chocolatey RefreshEnv).
const IGNORE_NAME_SET = new Set([
  "antigravity",
  "ollama app",
  "javaw",
  "gitk",
  "git-gui",
  "elevate",
  "nodevars",
  "refreshenv",
  "nvdlisrwrapper",
  "scalar",
]);

// Path fragments (case-insensitive) whose binaries are internal runtimes,
// bundled dependencies, host-app components, or toolchain utility dumps
// rather than user-facing CLIs. Especially important on Windows where Git for
// Windows / MSYS / MinGW flood PATH with hundreds of unixy helpers.
const IGNORE_PATH_FRAGMENTS = [
  ".codex/tmp",
  ".codex\\tmp",
  "codex-runtimes",
  "windowsapps/openai.codex_",
  "windowsapps\\openai.codex_",
  "nvidia app/nvdlisr",
  "nvidia app\\nvdlisr",
  // Git for Windows / MSYS / MinGW / Cygwin internal utility bins
  "mingw64\\bin",
  "mingw64/bin",
  "mingw32\\bin",
  "mingw32/bin",
  "git\\usr\\bin",
  "git/usr/bin",
  "git\\usr\\libexec",
  "git/usr/libexec",
  "git\\mingw64\\bin",
  "git/mingw64/bin",
  "git\\mingw32\\bin",
  "git/mingw32/bin",
  "msys64\\usr\\bin",
  "msys64/usr/bin",
  "msys64\\mingw64\\bin",
  "msys64/mingw64/bin",
  "msys2\\usr\\bin",
  "msys2/usr/bin",
  "cygwin\\bin",
  "cygwin/bin",
  "cygwin64\\bin",
  "cygwin64/bin",
  "libexec\\git-core",
  "libexec/git-core",
  "usr\\bin\\core_perl",
  "usr/bin/core_perl",
];

// Well-known CLIs users actually type day-to-day. Used for the default
// "recommended" view. Uncommon PATH noise stays available under view=all.
const RECOMMENDED_CLI_NAMES = new Set([
  // runtimes / package managers
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "pipx",
  "ruby",
  "gem",
  "bundle",
  "go",
  "rustc",
  "cargo",
  "rustup",
  "rust-analyzer",
  "java",
  "javac",
  "mvn",
  "gradle",
  "dotnet",
  "php",
  "composer",
  "perl",
  "lua",
  // vcs
  "git",
  "gh",
  "glab",
  "svn",
  "hg",
  // containers / cloud / infra
  "docker",
  "docker-compose",
  "podman",
  "kubectl",
  "helm",
  "terraform",
  "pulumi",
  "ansible",
  "aws",
  "az",
  "gcloud",
  "flyctl",
  "vercel",
  "netlify",
  "wrangler",
  // AI / agent CLIs
  "claude",
  "codex",
  "gemini",
  "ollama",
  "aider",
  "cursor",
  "opencode",
  "agent",
  "agent-gateway",
  "sgpt",
  "llm",
  // everyday developer utilities
  "rg",
  "fd",
  "fzf",
  "bat",
  "eza",
  "exa",
  "jq",
  "yq",
  "http",
  "httpie",
  "curl",
  "wget",
  "make",
  "cmake",
  "ninja",
  "just",
  "task",
  "tmux",
  "nvim",
  "vim",
  "code",
  "code-insiders",
  "sqlite3",
  "psql",
  "redis-cli",
  "mongosh",
  "ffmpeg",
  "ffprobe",
  "magick",
  // package managers / shells people intentionally install
  "winget",
  "scoop",
  "choco",
  "brew",
  "pwsh",
  // common node tooling
  "tsx",
  "ts-node",
  "nodemon",
  "vite",
  "next",
  "turbo",
  "nx",
]);

// Paths that mean the user intentionally dropped a CLI here. These promote
// uncommon names into the recommended view. Bulk toolchain dumps (cargo bin,
// go bin, nvm node bin, homebrew cellar dumps) are intentionally excluded —
// only exact allowlisted names from those locations stay recommended.
const BROAD_USER_INSTALL_PATH_FRAGMENTS = [
  `${path.sep}.local${path.sep}bin`,
  "appdata\\roaming\\npm",
  "appdata/roaming/npm",
  "appdata\\roaming\\uv",
  "appdata/roaming/uv",
  "appdata\\local\\programs",
  "appdata/local/programs",
  ".npm-global",
  "/usr/local/lib/node_modules/.bin",
  "/opt/homebrew/lib/node_modules/.bin",
];

// Satellite / helper binaries that ship next to real CLIs. Keep them visible
// under view=all, but never promote them into the default recommended list.
const SATELLITE_CLI_NAME_RE =
  /^(cargo-.+|clippy-driver|rustdoc|rust-gdb|rust-lldb|rls|corepack|npm-prefix|npm-cli|nodevars|tsc-help)$/i;

// Package-manager / installer sources count as recommended for non-satellite
// names, because the user (or a managed installer) put them there on purpose.
// Bare PATH dumps and bulk toolchain bins do not auto-promote.
const RECOMMENDED_SOURCES = new Set([
  "uv",
  "npm",
  "curl",
  "winget",
  "irm",
  "homebrew",
  "choco",
  "scoop",
  "pipx",
]);

function pathDirs() {
  const envPath = process.env.PATH || process.env.Path || "";
  const sep = isWindows ? ";" : ":";
  return envPath.split(sep).map((p) => p.trim()).filter(Boolean);
}

function isSystemDir(dir) {
  if (!isWindows) {
    // macOS system dirs hold ~1200 OS built-ins (ls, cp, mount, ...) that are
    // not user-installed CLIs. Filter them so only real tools from homebrew,
    // ~/.local/bin, npm, etc. surface in scan results.
    const macosSystem = ["/usr/bin", "/usr/sbin", "/bin", "/sbin"];
    const lower = dir.toLowerCase();
    if (macosSystem.includes(lower)) return true;
    if (lower === "/system" || lower.startsWith("/system/")) return true;
    if (lower.startsWith("/var/run/com.apple.security.cryptexd/")) return true;
    return false;
  }
  const root = (process.env.SystemRoot || process.env.windir || "C:\\Windows").toLowerCase();
  const lower = dir.toLowerCase();
  return lower === root || lower.startsWith(root + "\\");
}

// macOS app bundles expose internal helpers via PATH (e.g. ChatGPT.app's
// codex-code-mode-host, Yunshu's ping shim). These are app components, not
// user-installed CLIs, so skip any directory inside a .app bundle.
function isAppBundleDir(dir) {
  if (process.platform !== "darwin") return false;
  const lower = String(dir || "").toLowerCase();
  return lower.includes("/contents/");
}

function isExecutableName(name) {
  if (!isWindows) return true;
  return WIN_EXE_EXTS.has(path.extname(name).toLowerCase());
}

function baseName(name) {
  return isWindows ? name.replace(/\.(exe|cmd|bat)$/i, "") : name;
}

function isIgnoredName(name) {
  const base = baseName(name);
  if (!base) return false;
  if (IGNORE_NAME_SET.has(base.toLowerCase())) return true;
  if (IGNORE_NAME_RE.test(base)) return true;
  return false;
}

function isIgnoredPath(fullPath) {
  if (!fullPath) return false;
  const lower = String(fullPath).toLowerCase();
  for (const frag of IGNORE_PATH_FRAGMENTS) {
    if (lower.includes(frag.toLowerCase())) return true;
  }
  return false;
}

function isBroadUserInstallPath(fullPath) {
  if (!fullPath) return false;
  const lower = String(fullPath).toLowerCase();
  for (const frag of BROAD_USER_INSTALL_PATH_FRAGMENTS) {
    if (lower.includes(frag.toLowerCase())) return true;
  }
  return false;
}

function isSatelliteCliName(name) {
  const base = String(name || "").toLowerCase();
  if (!base) return false;
  // Keep a few well-known tools that look satellite-ish but are primary CLIs.
  if (base === "rust-analyzer" || base === "cargo" || base === "rustc" || base === "rustup") {
    return false;
  }
  return SATELLITE_CLI_NAME_RE.test(base);
}

function classifyTier(item, favoriteSet) {
  const name = String(item.name || "").toLowerCase();
  // Explicit user pin always wins, including over satellite demotion.
  if (favoriteSet && (favoriteSet.has(item.name) || favoriteSet.has(name))) {
    return "recommended";
  }
  // Satellite helpers always stay in "all", never the default recommended view.
  if (isSatelliteCliName(name)) return "other";
  if (RECOMMENDED_CLI_NAMES.has(name)) return "recommended";
  const source = String(item.source || "").toLowerCase();
  if (source && RECOMMENDED_SOURCES.has(source)) return "recommended";
  // Custom / non-path sources that the user added also count as intentional,
  // but still exclude satellite helpers above.
  if (source && source !== "path") return "recommended";
  if (isBroadUserInstallPath(item.path)) return "recommended";
  return "other";
}

function scanDir(dir) {
  const out = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!isExecutableName(name)) continue;
    if (isIgnoredName(name)) continue;
    const full = path.join(dir, name);
    if (isIgnoredPath(full)) continue;
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (!isWindows && (st.mode & 0o111) === 0) continue;
    } catch {
      continue;
    }
    out.push({ name: baseName(name), path: full });
  }
  return out;
}

function dirsForSource(source) {
  const dirs = [];
  for (const pat of source.dirs || []) {
    if (String(pat).trim().toUpperCase() === "$PATH") {
      dirs.push(...pathDirs().filter((d) => !isSystemDir(d) && !isAppBundleDir(d)));
    } else {
      // Explicit source dirs still skip toolchain dumps so MinGW/Git usr bins
      // never flood either the recommended or all views.
      dirs.push(...expandDirs([pat]).filter((d) => !isIgnoredPath(d)));
    }
  }
  return dirs;
}

function scanBinaries(sources, ignoredSet) {
  const seen = new Map();
  for (const source of sources) {
    if (source.enabled === false) continue;
    const label = source.name || source.id || "unknown";
    for (const dir of dirsForSource(source)) {
      if (isIgnoredPath(dir)) continue;
      for (const bin of scanDir(dir)) {
        if (ignoredSet && ignoredSet.has(bin.name)) continue;
        if (!seen.has(bin.name)) {
          seen.set(bin.name, { name: bin.name, path: bin.path, source: label });
        }
      }
    }
  }
  return [...seen.values()];
}

function cleanVersion(stdout) {
  const line = String(stdout || "").trim().split(/\r?\n/)[0];
  return line ? line.slice(0, 120) : null;
}

async function probeVersion(item) {
  const opts = { encoding: "utf8", timeout: 3000, windowsHide: true, maxBuffer: 1 << 20 };
  try {
    if (isWindows) {
      // For .cmd/.bat wrappers a shell is still needed to resolve them, but
      // windowsHide keeps any window hidden. For real .exe we spawn directly
      // (no shell) so no console window flashes at all.
      const needsShell = /\.(cmd|bat)$/i.test(item.path);
      const { stdout } = await execFileP(item.path, ["--version"], { ...opts, shell: needsShell });
      return cleanVersion(stdout);
    }
    const { stdout } = await execFileP(item.path, ["--version"], opts);
    return cleanVersion(stdout);
  } catch {
    return null;
  }
}

async function probeAll(items, concurrency = 16) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await probeVersion(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function matchesQuery(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    (item.path || "").toLowerCase().includes(q) ||
    (item.source || "").toLowerCase().includes(q) ||
    (item.tier || "").toLowerCase().includes(q)
  );
}

function normalizeView(view) {
  const v = String(view || "recommended").toLowerCase();
  return v === "all" ? "all" : "recommended";
}

// Scan the machine for installed CLI binaries. Sources are configurable (uv,
// npm, curl, homebrew, winget, irm, PATH, plus user-added). Only installed
// binaries appear; uninstallers/installers/OS built-ins/toolchain dumps are
// filtered out. By default the "recommended" view is returned (common CLIs +
// intentional installs). Pass view:"all" for every surviving scan hit. Version
// probing is OFF by default so opening the tab does not spawn processes
export function scanInRepoClis(configDir = process.cwd(), fsImpl = fs) {
  if (!configDir) return [];
  const clisDir = path.join(configDir, "clis");
  try {
    if (!fsImpl.existsSync(clisDir)) return [];
  } catch {
    return [];
  }
  let entries;
  try {
    entries = fsImpl.readdirSync(clisDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const list = [];
  for (const entry of entries) {
    const isDir = typeof entry === "string"
      ? fsImpl.statSync(path.join(clisDir, entry)).isDirectory()
      : entry.isDirectory();
    if (!isDir) continue;
    const subName = typeof entry === "string" ? entry : entry.name;
    if (subName.startsWith(".") || subName === "node_modules" || subName === "bin") continue;

    const subDir = path.join(clisDir, subName);
    const relSubDir = `./clis/${subName}`;

    const checkFile = (f) => {
      try { return fsImpl.existsSync(path.join(subDir, f)); } catch { return false; }
    };

    try {
      const files = fsImpl.readdirSync(subDir);
      if (!files.some((f) => (typeof f === "string" ? !f.startsWith(".") : f.isFile()))) continue;
    } catch {
      continue;
    }

    let readmeDesc = "";
    if (checkFile("README.md")) {
      try {
        const readmeContent = fsImpl.readFileSync(path.join(subDir, "README.md"), "utf8");
        const lines = readmeContent.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---") && !trimmed.startsWith("!")) {
            readmeDesc = trimmed.replace(/^[>\s*-]+/, "").trim();
            if (readmeDesc) break;
          }
        }
      } catch {}
    }

    const javaFiles = ["App.java", "Main.java", "main.java", "app.java", "cli.java", "Cli.java"];
    const foundJava = javaFiles.find(checkFile);
    let anyJava = null;
    if (!foundJava) {
      try {
        const all = fsImpl.readdirSync(subDir);
        anyJava = all.find((f) => typeof f === "string" && f.endsWith(".java"));
      } catch {}
    }
    const hasPom = checkFile("pom.xml") || checkFile("build.gradle");

    const pyFiles = ["cli.py", "main.py", "app.py", "server.py"];
    const foundPy = pyFiles.find(checkFile);
    const hasPyProject = checkFile("pyproject.toml") || checkFile("requirements.txt");

    const nodeFiles = ["index.mjs", "index.js", "cli.mjs", "bin/cli.mjs", "src/index.ts", "src/index.js"];
    const foundNode = nodeFiles.find(checkFile);
    const hasPackageJson = checkFile("package.json");

    const goFiles = ["main.go", "cli.go", "app.go"];
    const foundGo = goFiles.find(checkFile);
    const hasGoMod = checkFile("go.mod");
    const hasCompiledExe = checkFile("app.exe") ? "app.exe" : checkFile(`${subName}.exe`) ? `${subName}.exe` : null;

    const psFiles = ["run.ps1", "cli.ps1", `${subName}.ps1`];
    const foundPs = psFiles.find(checkFile);
    const shFiles = ["run.sh", "cli.sh", `${subName}.sh`];
    const foundSh = shFiles.find(checkFile);

    if (foundJava || anyJava) {
      const javaFile = foundJava || anyJava;
      list.push({
        name: subName,
        lang: "java",
        langLabel: "Java JBang",
        title: `${subName} (Java JBang CLI)`,
        description: readmeDesc || `位于 ${relSubDir} 的自研 Java JBang 命令行工具`,
        command: "jbang",
        args: [`${relSubDir}/${javaFile}`],
        fullCommand: `jbang ${relSubDir}/${javaFile}`,
        path: `${relSubDir}/${javaFile}`,
      });
    } else if (hasPom) {
      list.push({
        name: subName,
        lang: "java",
        langLabel: "Java JAR",
        title: `${subName} (Java Maven/Gradle CLI)`,
        description: readmeDesc || `位于 ${relSubDir} 的自研 Java 打包命令行工具`,
        command: "java",
        args: ["-jar", `${relSubDir}/target/app.jar`],
        fullCommand: `java -jar ${relSubDir}/target/app.jar`,
        path: `${relSubDir}/pom.xml`,
      });
    } else if (foundPy || hasPyProject) {
      const pyFile = foundPy || "cli.py";
      list.push({
        name: subName,
        lang: "python",
        langLabel: "Python (uv)",
        title: `${subName} (Python CLI)`,
        description: readmeDesc || `位于 ${relSubDir} 的自研 Python (uv) 命令行工具`,
        command: "uv",
        args: ["run", "--directory", relSubDir, pyFile],
        fullCommand: `uv run --directory ${relSubDir} ${pyFile}`,
        path: `${relSubDir}/${pyFile}`,
      });
    } else if (foundNode || hasPackageJson) {
      const entryFile = foundNode || "index.mjs";
      list.push({
        name: subName,
        lang: "node",
        langLabel: "Node.js",
        title: `${subName} (Node.js CLI)`,
        description: readmeDesc || `位于 ${relSubDir} 的自研 Node.js 命令行工具`,
        command: "node",
        args: [`${relSubDir}/${entryFile}`],
        fullCommand: `node ${relSubDir}/${entryFile}`,
        path: `${relSubDir}/${entryFile}`,
      });
    } else if (foundGo || hasGoMod || hasCompiledExe) {
      if (hasCompiledExe) {
        list.push({
          name: subName,
          lang: "go",
          langLabel: "Go 二进制",
          title: `${subName} (Go 二进制 CLI)`,
          description: readmeDesc || `位于 ${relSubDir} 的自研 Go 独立编译 CLI 工具`,
          command: `${relSubDir}/${hasCompiledExe}`,
          args: [],
          fullCommand: `${relSubDir}/${hasCompiledExe}`,
          path: `${relSubDir}/${hasCompiledExe}`,
        });
      } else {
        const goFile = foundGo || "main.go";
        list.push({
          name: subName,
          lang: "go",
          langLabel: "Go 源码",
          title: `${subName} (Go CLI)`,
          description: readmeDesc || `位于 ${relSubDir} 的自研 Go 源码 CLI 工具`,
          command: "go",
          args: ["run", `${relSubDir}/${goFile}`],
          fullCommand: `go run ${relSubDir}/${goFile}`,
          path: `${relSubDir}/${goFile}`,
        });
      }
    } else if (foundPs) {
      list.push({
        name: subName,
        lang: "powershell",
        langLabel: "PowerShell",
        title: `${subName} (PowerShell CLI)`,
        description: readmeDesc || `位于 ${relSubDir} 的自研 PowerShell 脚本工具`,
        command: "pwsh",
        args: [`${relSubDir}/${foundPs}`],
        fullCommand: `pwsh ${relSubDir}/${foundPs}`,
        path: `${relSubDir}/${foundPs}`,
      });
    } else if (foundSh) {
      list.push({
        name: subName,
        lang: "shell",
        langLabel: "Shell 脚本",
        title: `${subName} (Bash CLI)`,
        description: readmeDesc || `位于 ${relSubDir} 的自研 Shell 脚本工具`,
        command: "bash",
        args: [`${relSubDir}/${foundSh}`],
        fullCommand: `bash ${relSubDir}/${foundSh}`,
        path: `${relSubDir}/${foundSh}`,
      });
    } else {
      list.push({
        name: subName,
        lang: "custom",
        langLabel: "自研 CLI",
        title: `${subName} (自研 CLI)`,
        description: readmeDesc || `位于 ${relSubDir} 的自研命令行工具`,
        command: "node",
        args: [`${relSubDir}/index.mjs`],
        fullCommand: `node ${relSubDir}/index.mjs`,
        path: relSubDir,
      });
    }
  }
  return list;
}

// (which on Windows can flash terminal windows). Pass probe:true to fetch
// versions for the selected view only. Pass ignored (Set) to exclude CLI
// names the user opted-out of.
export async function discoverInstalledClis({
  query = "",
  probe = false,
  sources,
  ignored,
  favorites,
  view = "recommended",
  rootDir = process.cwd(),
} = {}) {
  const resolved = sources || CliSourceConfig.list();
  const ignoredSet = ignored instanceof Set ? ignored : new Set(ignored || []);
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites || []);
  const selectedView = normalizeView(view);
  const found = scanBinaries(resolved, ignoredSet);
  const inRepoClis = scanInRepoClis(rootDir);

  const classified = found
    .map((b) => {
      const favorite = favoriteSet.has(b.name);
      return {
        name: b.name,
        command: b.name,
        installed: true,
        path: b.path,
        version: null,
        source: b.source || null,
        favorite,
        tier: classifyTier(b, favoriteSet),
      };
    })
    // Favorites first, then alphabetical within each group.
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const recommendedCount = classified.filter((item) => item.tier === "recommended").length;
  const viewItems =
    selectedView === "all"
      ? classified
      : classified.filter((item) => item.tier === "recommended");
  const filtered = viewItems.filter((item) => matchesQuery(item, query));

  if (probe && filtered.length) {
    const versions = await probeAll(filtered);
    for (let i = 0; i < filtered.length; i++) {
      filtered[i] = { ...filtered[i], version: versions[i] || null };
    }
  }

  return {
    items: filtered,
    inRepoClis,
    stats: {
      total: classified.length,
      installed: classified.length,
      recommended: recommendedCount,
      other: classified.length - recommendedCount,
      shown: filtered.length,
      view: selectedView,
    },
  };
}

export const __test__ = {
  isIgnoredPath,
  isIgnoredName,
  classifyTier,
  isSatelliteCliName,
  isBroadUserInstallPath,
  normalizeView,
  RECOMMENDED_CLI_NAMES,
  IGNORE_PATH_FRAGMENTS,
  scanInRepoClis,
};
