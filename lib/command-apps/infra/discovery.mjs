import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CommandAppsError } from "../domain/errors.mjs";

const execFileP = promisify(execFile);

function wellKnownPaths(app, env = process.env) {
  const localAppData = env.LOCALAPPDATA || "";
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const candidates = [];
  if (localAppData) {
    candidates.push(path.join(localAppData, "Programs", "antigravity", app.executableName));
    candidates.push(path.join(localAppData, "antigravity", app.executableName));
  }
  candidates.push(path.join(programFiles, "Antigravity", app.executableName));
  candidates.push(path.join("C:\\Program Files", "Antigravity", app.executableName));
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

function normalizeCandidate(raw, strategy, source) {
  const value = String(raw || "").trim().replace(/^"|"$/g, "");
  if (!value || !path.isAbsolute(value)) return null;
  const candidate = path.resolve(value);
  if (path.extname(candidate).toLowerCase() !== ".exe") return null;
  return { path: candidate, strategy, source };
}

async function isValidExecutable(candidate, {
  fileExists = (value) => fs.existsSync(value),
  statFile = (value) => fs.promises.stat(value),
}) {
  if (!fileExists(candidate)) return false;
  try {
    const stat = await statFile(candidate);
    return Boolean(stat?.isFile?.());
  } catch {
    return false;
  }
}

export async function discoverCommandApp(app, {
  platform = process.platform,
  env = process.env,
  fileExists = (value) => fs.existsSync(value),
  statFile = (value) => fs.promises.stat(value),
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

  const groups = [];
  groups.push({
    strategy: "well-known-localappdata",
    values: wellKnownPaths(app, env),
  });
  groups.push({
    strategy: "windows-app-paths",
    values: await queryAppPaths(app.executableName),
  });
  groups.push({
    strategy: "path-environment",
    values: (await searchPathDirs(env)).map((dir) => path.join(dir, app.executableName)),
  });
  groups.push({
    strategy: "start-menu-shortcuts",
    values: [await readShortcutTarget()],
  });

  const seen = new Set();
  const candidates = [];
  for (const group of groups) {
    for (const raw of group.values) {
      const candidate = normalizeCandidate(raw, group.strategy, "local-system");
      if (!candidate) continue;
      const key = candidate.path.toLowerCase();
      if (seen.has(key)) continue;
      if (!(await isValidExecutable(candidate.path, { fileExists, statFile }))) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return {
    selected: candidates[0] || null,
    candidates,
  };
}
