import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function runProcess(cmd, args = [], { onLog, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const isWindows = process.platform === "win32";
    // Avoid shell: true unless executing bat or cmd
    const useShell = isWindows && (cmd.endsWith(".cmd") || cmd.endsWith(".bat"));
    const proc = spawn(cmd, args, {
      shell: useShell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onLog) onLog(text);
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onLog) onLog(text);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

export class BaseEngineAdapter {
  constructor({ id, name, description, command, supportedExtensions = [] }) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.command = command;
    this.supportedExtensions = supportedExtensions;
  }

  async detect() {
    const isWindows = process.platform === "win32";
    const userProfile = process.env.USERPROFILE || process.env.HOME || "";

    // 1. Fast Path: Check standard uv tool metadata directory directly (instant < 3ms)
    try {
      const uvToolsDir = isWindows
        ? path.join(process.env.APPDATA || path.join(userProfile, "AppData", "Roaming"), "uv", "tools", this.id)
        : path.join(process.env.XDG_DATA_HOME || path.join(userProfile, ".local", "share"), "uv", "tools", this.id);

      const localBinDir = path.join(userProfile, ".local", "bin");
      const exeExt = isWindows ? ".exe" : "";
      const directBin = path.join(localBinDir, `${this.command}${exeExt}`);

      if (fs.existsSync(directBin)) {
        let fastVersion = null;
        if (fs.existsSync(uvToolsDir)) {
          const spWin = path.join(uvToolsDir, "Lib", "site-packages");
          const spUnix = path.join(uvToolsDir, "lib");
          let searchDir = fs.existsSync(spWin) ? spWin : null;
          if (!searchDir && fs.existsSync(spUnix)) {
            const pySub = fs.readdirSync(spUnix).find((d) => d.startsWith("python"));
            if (pySub) {
              const cand = path.join(spUnix, pySub, "site-packages");
              if (fs.existsSync(cand)) searchDir = cand;
            }
          }
          if (searchDir) {
            const entries = fs.readdirSync(searchDir);
            const prefix = this.id.replace(/-/g, "_").toLowerCase();
            const dist = entries.find((e) => e.toLowerCase().startsWith(`${prefix}-`) && e.endsWith(".dist-info"));
            if (dist) {
              const m = dist.match(new RegExp(`^${prefix}-([\\d\\w.]+)\\.dist-info$`, "i"));
              if (m) fastVersion = m[1];
            }
          }
        }
        return {
          id: this.id,
          name: this.name,
          installed: true,
          binPath: directBin,
          version: fastVersion || "installed",
          platformSupport: true,
          installCommand: `uv tool install ${this.id}`,
          upgradeCommand: `uv tool upgrade ${this.id}`,
        };
      }
    } catch {
      // ignore and fallback
    }

    // 2. Fallback Path: where / which
    const lookupCmd = isWindows ? "where.exe" : "which";
    try {
      const { stdout } = await runProcess(lookupCmd, [this.command], { timeoutMs: 3000 });
      const binPath = stdout.split(/\r?\n/)[0]?.trim() || null;
      let version = null;
      if (binPath) {
        try {
          const vRes = await runProcess(this.command, ["--version"], { timeoutMs: 3000 });
          version = vRes.stdout.trim() || vRes.stderr.trim() || "installed";
        } catch {
          version = "installed";
        }
      }
      return {
        id: this.id,
        name: this.name,
        installed: Boolean(binPath),
        binPath,
        version,
        platformSupport: true,
        installCommand: `uv tool install ${this.id}`,
        upgradeCommand: `uv tool upgrade ${this.id}`,
      };
    } catch {
      return {
        id: this.id,
        name: this.name,
        installed: false,
        binPath: null,
        version: null,
        platformSupport: true,
        installCommand: `uv tool install ${this.id}`,
        upgradeCommand: `uv tool upgrade ${this.id}`,
      };
    }
  }

  async install(onLog) {
    if (onLog) onLog(`> uv tool install ${this.id}\n`);
    await runProcess("uv", ["tool", "install", this.id], { onLog, timeoutMs: 300_000 });
  }

  async upgrade(onLog) {
    if (onLog) onLog(`> uv tool upgrade ${this.id}\n`);
    await runProcess("uv", ["tool", "upgrade", this.id], { onLog, timeoutMs: 300_000 });
  }

  async parse(inputPath, options) {
    throw new Error("Method parse() must be implemented by subclass");
  }
}

export class MarkItDownAdapter extends BaseEngineAdapter {
  constructor() {
    super({
      id: "markitdown",
      name: "MarkItDown (微软)",
      description: "轻量极速，适用于常见办公文件 (Word/Excel/PPT/HTML/TXT) 毫秒级提取",
      command: "markitdown",
      supportedExtensions: [".docx", ".pptx", ".xlsx", ".html", ".htm", ".txt", ".md", ".pdf", ".csv", ".json", ".xml"],
    });
  }

  buildParseCommand(inputPath, { outputFilePath } = {}) {
    const args = [inputPath];
    if (outputFilePath) {
      args.push("-o", outputFilePath);
    }
    return { command: this.command, args };
  }

  async parse(inputPath, { outputDir = null } = {}) {
    const start = Date.now();
    const isTempOutput = !outputDir;
    const workDir = outputDir || fs.mkdtempSync(path.join(path.dirname(inputPath), "md_out_"));
    const outMdPath = path.join(workDir, "output.md");

    try {
      const { command, args } = this.buildParseCommand(inputPath, { outputFilePath: outMdPath });
      await runProcess(command, args, { timeoutMs: 60_000 });

      let markdown = "";
      if (fs.existsSync(outMdPath)) {
        markdown = fs.readFileSync(outMdPath, "utf8");
      }

      const durationMs = Date.now() - start;
      const wordCount = markdown.replace(/\s+/g, "").length;

      return {
        engineId: this.id,
        markdown,
        html: null,
        jsonStructure: null,
        assets: [],
        durationMs,
        wordCount,
      };
    } finally {
      if (isTempOutput && fs.existsSync(workDir)) {
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  }
}

export class DoclingAdapter extends BaseEngineAdapter {
  constructor() {
    super({
      id: "docling",
      name: "Docling (IBM)",
      description: "深度版面视觉分析与 TableFormer 表格还原，专业应对科研论文、扫描件及复杂 PDF",
      command: "docling",
      supportedExtensions: [".pdf", ".docx", ".pptx", ".html", ".asciidoc", ".md", ".png", ".jpg", ".jpeg"],
    });
  }

  buildParseCommand(inputPath, { outputDir, assetsDir } = {}) {
    const args = [inputPath, "--to", "md", "--to", "html", "--to", "json"];
    if (assetsDir) {
      args.push("--artifacts-path", assetsDir);
    }
    if (outputDir) {
      args.push("--output", outputDir);
    }
    return { command: this.command, args };
  }

  async parse(inputPath, { outputDir, assetsDir } = {}) {
    const start = Date.now();
    const workDir = outputDir || fs.mkdtempSync(path.join(path.dirname(inputPath), "docling_out_"));
    const workAssetsDir = assetsDir || path.join(workDir, "assets");
    if (!fs.existsSync(workAssetsDir)) {
      fs.mkdirSync(workAssetsDir, { recursive: true });
    }

    try {
      const { command, args } = this.buildParseCommand(inputPath, {
        outputDir: workDir,
        assetsDir: workAssetsDir,
      });

      await runProcess(command, args, { timeoutMs: 180_000 });

      const baseName = path.basename(inputPath, path.extname(inputPath));
      let markdown = "";
      let html = "";
      let jsonStructure = null;

      // Locate generated output files
      const mdFile = path.join(workDir, `${baseName}.md`);
      const htmlFile = path.join(workDir, `${baseName}.html`);
      const jsonFile = path.join(workDir, `${baseName}.json`);

      if (fs.existsSync(mdFile)) markdown = fs.readFileSync(mdFile, "utf8");
      if (fs.existsSync(htmlFile)) html = fs.readFileSync(htmlFile, "utf8");
      if (fs.existsSync(jsonFile)) {
        try {
          jsonStructure = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
        } catch {
          jsonStructure = null;
        }
      }

      // Scan assets
      const assets = [];
      if (fs.existsSync(workAssetsDir)) {
        const files = fs.readdirSync(workAssetsDir);
        for (const f of files) {
          const fullPath = path.join(workAssetsDir, f);
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            assets.push({
              name: f,
              localPath: fullPath,
              url: `assets/${f}`,
              sizeBytes: stat.size,
            });
          }
        }
      }

      const durationMs = Date.now() - start;
      const wordCount = markdown.replace(/\s+/g, "").length;

      return {
        engineId: this.id,
        markdown,
        html,
        jsonStructure,
        assets,
        durationMs,
        wordCount,
      };
    } catch (err) {
      throw new Error(`Docling parse error: ${err.message}`);
    }
  }
}

export function createEngineRegistry() {
  const adapters = new Map();

  let cachedStatuses = null;
  let cacheTime = 0;

  function register(adapter) {
    if (!adapter || !adapter.id) {
      throw new Error("Invalid adapter: must have an id property");
    }
    adapters.set(adapter.id, adapter);
    cachedStatuses = null;
  }

  function get(id) {
    return adapters.get(id) || null;
  }

  function list() {
    return Array.from(adapters.values());
  }

  async function detectAll(force = false) {
    const now = Date.now();
    if (!force && cachedStatuses && now - cacheTime < 60_000) {
      return cachedStatuses;
    }
    const entries = Array.from(adapters.entries());
    const detected = await Promise.all(
      entries.map(async ([id, adapter]) => [id, await adapter.detect()])
    );
    cachedStatuses = Object.fromEntries(detected);
    cacheTime = now;
    return cachedStatuses;
  }

  async function install(id, onLog) {
    const adapter = get(id);
    if (!adapter) throw new Error(`Unknown engine adapter: ${id}`);
    await adapter.install(onLog);
    cachedStatuses = null;
    return await adapter.detect();
  }

  async function upgrade(id, onLog) {
    const adapter = get(id);
    if (!adapter) throw new Error(`Unknown engine adapter: ${id}`);
    await adapter.upgrade(onLog);
    cachedStatuses = null;
    return await adapter.detect();
  }

  return {
    register,
    get,
    list,
    detectAll,
    install,
    upgrade,
  };
}
