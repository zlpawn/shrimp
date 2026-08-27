import fs from "node:fs";
import path from "node:path";

const MANAGED_MARKER = "# >>> shrimp managed cli shim >>>";

function normalizeName(name) {
  return String(name || "").trim();
}

function resolveAgainstSourceRoot(value, sourceRoot) {
  const text = String(value);
  if (!text || !text.startsWith(".")) return text;
  if (path.isAbsolute(text)) return text;
  return path.resolve(sourceRoot, text);
}

function singleQuote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

function doubleQuote(value) {
  return '"' + String(value).replaceAll('"', '\\"') + '"';
}

function buildShim(options) {
  const name = normalizeName(options.name);
  const args = options.args || [];
  if (!name) throw new Error("CLI name is required");
  if (!options.command) throw new Error("CLI command is required");

  const renderedArgs = args.map(doubleQuote);
  return [
    "#!/bin/sh",
    MANAGED_MARKER,
    "# Managed by Shrimp. Repair with: shrimp cli repair " + name,
    "SOURCE_ROOT=" + singleQuote(options.sourceRoot),
    "export SOURCE_ROOT",
    ["exec", options.command, ...renderedArgs, '"$@"'].join(" "),
    "",
  ].join("\n");
}

function shellProfile({ platform, shell }) {
  if (platform === "win32") return { file: ".bashrc", shell: "git-bash" };
  if (String(shell || "").includes("zsh")) return { file: ".zshrc", shell: "zsh" };
  return { file: ".bashrc", shell: "bash" };
}

function pathLine(binDir) {
  return 'export PATH="$HOME/' + path.join(".shrimp", "bin").replaceAll("\\", "/") + ':$PATH"';
}

export function createCliShimManager(options = {}) {
  const homeDir = options.homeDir || process.env.USERPROFILE || process.env.HOME || process.cwd();
  const dataDir = options.dataDir;
  const sourceRoot = options.sourceRoot || process.cwd();
  const platform = options.platform || process.platform;
  const shell = options.shell || process.env.SHELL || "";
  const fsImpl = options.fsImpl || fs;
  const now = options.now || (() => new Date().toISOString());
  if (!homeDir) throw new Error("homeDir is required");
  if (!dataDir) throw new Error("dataDir is required");

  const binDir = path.join(homeDir, ".shrimp", "bin");
  const registryFile = path.join(dataDir, "cli-shims.json");

  function ensureDir(dir) {
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }

  function readRegistry() {
    try {
      const raw = JSON.parse(fsImpl.readFileSync(registryFile, "utf8"));
      if (raw && typeof raw === "object" && raw.shims && typeof raw.shims === "object") return raw;
    } catch {
      // Missing or corrupt registry starts empty; install recreates it.
    }
    return { version: 1, shims: {} };
  }

  function writeRegistry(registry) {
    ensureDir(dataDir);
    registry.updatedAt = now();
    fsImpl.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + "\n", "utf8");
  }

  function shimPathFor(name) {
    return path.join(binDir, normalizeName(name));
  }

  function isManagedFile(file) {
    try {
      return fsImpl.readFileSync(file, "utf8").split(/\r?\n/, 3).includes(MANAGED_MARKER);
    } catch {
      return false;
    }
  }

  function resolveLauncher({ command, args }) {
    return {
      command,
      args: (args || []).map((arg) => resolveAgainstSourceRoot(arg, sourceRoot)),
    };
  }

  function install({ name, lang, command, args }) {
    const normalName = normalizeName(name);
    if (!normalName) throw new Error("CLI name is required");
    if (/[\\/]|\.(exe|cmd|bat|ps1)$/i.test(normalName)) throw new Error("CLI name is invalid: " + normalName);
    if (!command) throw new Error("CLI command is required");

    const registry = readRegistry();
    const existingRecord = registry.shims[normalName];
    const shimPath = shimPathFor(normalName);
    if (fsImpl.existsSync(shimPath) && !existingRecord && !isManagedFile(shimPath)) {
      const error = new Error("Refusing to overwrite " + shimPath + ": it already exists and is not managed by Shrimp");
      error.code = "shim_conflict";
      throw error;
    }

    const launcher = resolveLauncher({ command, args });
    ensureDir(binDir);
    fsImpl.writeFileSync(shimPath, buildShim({
      name: normalName,
      command: launcher.command,
      args: launcher.args,
      sourceRoot,
    }), { mode: 0o755, encoding: "utf8" });
    fsImpl.chmodSync(shimPath, 0o755);

    const repaired = Boolean(existingRecord);
    registry.shims[normalName] = {
      name: normalName,
      lang,
      command: launcher.command,
      args: launcher.args,
      sourceRoot,
      shimPath,
      installedAt: (existingRecord && existingRecord.installedAt) || now(),
      updatedAt: now(),
    };
    writeRegistry(registry);
    return {
      name: normalName,
      lang,
      shimPath,
      repaired,
      command: launcher.command,
      args: launcher.args,
    };
  }

  function uninstall(name) {
    const normalName = normalizeName(name);
    const registry = readRegistry();
    const record = registry.shims[normalName];
    const shimPath = shimPathFor(normalName);
    if (!record && !isManagedFile(shimPath)) {
      const error = new Error("Refusing to uninstall " + normalName + ": it is not managed by Shrimp");
      error.code = "shim_not_managed";
      throw error;
    }
    if (fsImpl.existsSync(shimPath)) fsImpl.unlinkSync(shimPath);
    if (record) {
      delete registry.shims[normalName];
      writeRegistry(registry);
    }
    return { name: normalName, removed: true, shimPath };
  }

  function list() {
    const registry = readRegistry();
    const shims = Object.values(registry.shims || {})
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((record) => ({ ...record, present: fsImpl.existsSync(record.shimPath) }));
    return { shims, binDir, registryFile };
  }

  function isInstalled(name) {
    return Boolean(readRegistry().shims[normalizeName(name)]);
  }

  function ensurePath() {
    const profile = shellProfile({ platform, shell });
    const rcPath = path.join(homeDir, profile.file);
    let content = "";
    try {
      content = fsImpl.readFileSync(rcPath, "utf8");
    } catch {
      content = "";
    }
    const begin = "# >>> shrimp bin >>>";
    const end = "# <<< shrimp bin <<<";
    const block = [begin, pathLine(binDir), end].join("\n");
    if (!content.includes(begin)) {
      content = (content.trimEnd() ? content.trimEnd() + "\n\n" : "") + block + "\n";
    } else if (!content.includes(pathLine(binDir))) {
      content = content.replace(new RegExp(begin + "[\\s\\S]*?" + end), block);
    }
    ensureDir(path.dirname(rcPath));
    fsImpl.writeFileSync(rcPath, content, "utf8");
    return { rcPath, shell: profile.shell, configured: true };
  }

  function status() {
    const profile = shellProfile({ platform, shell });
    const rcPath = path.join(homeDir, profile.file);
    let pathConfigured = false;
    try {
      pathConfigured = fsImpl.readFileSync(rcPath, "utf8").includes(pathLine(binDir));
    } catch {
      pathConfigured = false;
    }
    return { platform, shell: profile.shell, binDir, rcPath, pathConfigured, ...list() };
  }

  return { install, uninstall, list, isInstalled, ensurePath, status };
}
