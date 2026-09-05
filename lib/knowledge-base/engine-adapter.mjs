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
    const lookupCmd = isWindows ? "where.exe" : "which";
    try {
      const { stdout } = await runProcess(lookupCmd, [this.command], { timeoutMs: 5000 });
      const binPath = stdout.split(/\r?\n/)[0]?.trim() || null;
      let version = null;
      if (binPath) {
        try {
          const vRes = await runProcess(this.command, ["--version"], { timeoutMs: 5000 });
          version = vRes.stdout.trim() || vRes.stderr.trim() || "unknown";
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

  function register(adapter) {
    if (!adapter || !adapter.id) {
      throw new Error("Invalid adapter: must have an id property");
    }
    adapters.set(adapter.id, adapter);
  }

  function get(id) {
    return adapters.get(id) || null;
  }

  function list() {
    return Array.from(adapters.values());
  }

  async function detectAll() {
    const statuses = {};
    for (const [id, adapter] of adapters.entries()) {
      statuses[id] = await adapter.detect();
    }
    return statuses;
  }

  async function install(id, onLog) {
    const adapter = get(id);
    if (!adapter) throw new Error(`Unknown engine adapter: ${id}`);
    await adapter.install(onLog);
    return await adapter.detect();
  }

  async function upgrade(id, onLog) {
    const adapter = get(id);
    if (!adapter) throw new Error(`Unknown engine adapter: ${id}`);
    await adapter.upgrade(onLog);
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
