import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CommandAppsError } from "../domain/errors.mjs";

const execFileP = promisify(execFile);

function defaultReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function wellKnownPaths(app, env = process.env, pathLib = path.win32) {
  const localAppData = env.LOCALAPPDATA || "";
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const candidates = [];
  if (localAppData) {
    candidates.push(pathLib.join(localAppData, "Programs", "antigravity", app.executableName));
    candidates.push(pathLib.join(localAppData, "antigravity", app.executableName));
  }
  candidates.push(pathLib.join(programFiles, "Antigravity", app.executableName));
  candidates.push(pathLib.join("C:\\Program Files", "Antigravity", app.executableName));
  return candidates;
}

async function defaultQueryAppPaths(executableName) {
  const roots = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
  ];
  const values = [];
  for (const key of roots) {
    try {
      const { stdout } = await execFileP("reg", ["query", key, "/ve"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
      });
      const match = stdout.match(/REG_SZ\s+(.+)$/im);
      if (match?.[1]) values.push(match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // Missing registry keys are expected on many installations.
    }
  }
  return values;
}

async function defaultSearchPathDirs(env = process.env) {
  const value = env.PATH || env.Path || "";
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

async function defaultReadShortcutTarget() {
  const startMenu = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "Microsoft",
    "Windows",
    "Start Menu",
  );
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$roots = @('${startMenu.replace(/'/g, "''")}', '$env:ProgramData\\Microsoft\\Windows\\Start Menu')`,
    "$files = Get-ChildItem -Path $roots -Filter *.lnk -Recurse",
    "$shell = New-Object -ComObject WScript.Shell",
    "foreach ($file in $files) { if ($file.Name -match 'Antigravity') { $shell.CreateShortcut($file.FullName).TargetPath } }",
  ].join("; ");
  try {
    const { stdout } = await execFileP("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    return String(stdout || "").trim();
  } catch {
    return "";
  }
}

function normalizeCandidate(raw, strategy, source, pathLib = path) {
  const value = String(raw || "").trim().replace(/^"|"$/g, "");
  if (!value) return null;
  const isAbs = pathLib.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
  if (!isAbs) return null;
  const candidate = pathLib.resolve ? pathLib.resolve(value) : path.resolve(value);
  return { path: candidate, strategy, source };
}

async function isValidExecutable(candidate, {
  fileExists = (value) => fs.existsSync(value),
  statFile = (value) => fs.promises.stat(value),
  pathLib = path,
} = {}) {
  if (!fileExists(candidate)) return false;
  if (pathLib.extname(candidate).toLowerCase() !== ".exe") return false;
  try {
    const stat = await statFile(candidate);
    return Boolean(stat?.isFile?.());
  } catch {
    return false;
  }
}

function isProjectRootDirectory(dirPath, {
  fileExists = (value) => fs.existsSync(value),
  readJson = (p) => defaultReadJson(p),
  pathLib = path,
} = {}) {
  if (!dirPath || !fileExists(dirPath)) return false;
  const pkgPath = pathLib.join(dirPath, "package.json");
  if (!fileExists(pkgPath) && !fileExists(path.join(dirPath, "package.json"))) return false;
  try {
    const pkg = readJson(pkgPath) || readJson(path.join(dirPath, "package.json"));
    if (!pkg || typeof pkg !== "object") return false;
    const nameMatch = pkg.name === "@wuhezhizhong/shrimp" || pkg.name === "shrimp";
    const scriptMatch = Boolean(pkg.scripts?.["gateway:restart"] || pkg.scripts?.["gateway"]);
    const hasEntryMarkers = fileExists(pathLib.join(dirPath, "scripts", "gateway.mjs"))
      || fileExists(path.join(dirPath, "scripts", "gateway.mjs"))
      || fileExists(pathLib.join(dirPath, "server.js"))
      || fileExists(path.join(dirPath, "server.js"));
    return (nameMatch || scriptMatch) && hasEntryMarkers;
  } catch {
    return false;
  }
}

function findAncestorProjectRoots(startDir, options = {}) {
  if (!startDir) return [];
  const pathLib = options.platform === "win32" ? path.win32 : (options.pathLib || path);
  let current = pathLib.resolve(startDir);
  const found = [];
  while (true) {
    if (isProjectRootDirectory(current, { ...options, pathLib })) {
      found.push(current);
    }
    const parent = pathLib.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

export async function discoverCommandApp(app, {
  platform = process.platform,
  env = process.env,
  currentModuleDir = path.dirname(fileURLToPath(import.meta.url)),
  cwd = process.cwd(),
  fileExists = (value) => fs.existsSync(value),
  statFile = (value) => fs.promises.stat(value),
  readJson = (p) => defaultReadJson(p),
  queryAppPaths = (executableName) => defaultQueryAppPaths(executableName),
  searchPathDirs = (environment) => defaultSearchPathDirs(environment),
  readShortcutTarget = () => defaultReadShortcutTarget(),
} = {}) {
  if (!app) {
    throw new CommandAppsError("app_not_found", "Unknown command app");
  }
  if (!app.supportedPlatforms.includes(platform)) {
    throw new CommandAppsError(
      "unsupported_platform",
      `${app.displayName} discovery is not supported on ${platform}`,
    );
  }

  const pathLib = platform === "win32" ? path.win32 : path.posix;

  if (app.type === "project") {
    const groups = [];
    const options = { fileExists, readJson, platform, pathLib };
    if (currentModuleDir) {
      groups.push({
        strategy: "runtime-ancestor",
        values: findAncestorProjectRoots(currentModuleDir, options),
      });
    }
    const envRoot = env.SHRIMP_ROOT_DIR || env.GATEWAY_ROOT_DIR;
    if (envRoot && isProjectRootDirectory(envRoot, options)) {
      groups.push({
        strategy: "environment-root",
        values: [envRoot],
      });
    }
    if (cwd) {
      groups.push({
        strategy: "cwd-ancestor",
        values: findAncestorProjectRoots(cwd, options),
      });
    }

    const seen = new Set();
    const candidates = [];
    for (const group of groups) {
      for (const raw of group.values) {
        const candidate = normalizeCandidate(raw, group.strategy, "local-project", pathLib);
        if (!candidate) continue;
        const key = candidate.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }

    return {
      selected: candidates[0] || null,
      candidates,
    };
  }

  const groups = [];
  groups.push({
    strategy: "well-known-localappdata",
    values: wellKnownPaths(app, env, pathLib),
  });
  groups.push({
    strategy: "windows-app-paths",
    values: await queryAppPaths(app.executableName),
  });
  groups.push({
    strategy: "path-environment",
    values: (await searchPathDirs(env)).map((dir) => pathLib.join(dir, app.executableName)),
  });
  groups.push({
    strategy: "start-menu-shortcuts",
    values: [await readShortcutTarget()],
  });

  const seen = new Set();
  const candidates = [];
  for (const group of groups) {
    for (const raw of group.values) {
      const candidate = normalizeCandidate(raw, group.strategy, "local-system", pathLib);
      if (!candidate) continue;
      const key = candidate.path.toLowerCase();
      if (seen.has(key)) continue;
      if (!(await isValidExecutable(candidate.path, { fileExists, statFile, pathLib }))) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return {
    selected: candidates[0] || null,
    candidates,
  };
}
