#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, resolveArtifactsDir, resolveOutputDir } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHRIMP_ROOT = path.resolve(__dirname, "../../../..");

export function checkBinary(name) {
  try {
    const res = execSync(`command -v ${name}`, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    return res.trim();
  } catch {
    return null;
  }
}

export function probePythonEnv(customVenv) {
  const cfg = readConfig();
  const venvDir = customVenv || cfg.python_venv_path;
  const pyBin = path.join(venvDir, "bin", "python");
  const exists = fs.existsSync(pyBin);
  return {
    configuredPath: venvDir,
    binary: exists ? pyBin : null,
    ready: exists,
  };
}

export function probeBookToSkill() {
  const candidates = [
    path.join(os.homedir(), ".agents", "skills", "book-to-skill", "SKILL.md"),
    path.join(os.homedir(), ".claude", "skills", "book-to-skill", "SKILL.md"),
    "/Users/user/project/AI-SKILL-CREATOR/book-to-skill/SKILL.md",
    path.join(SHRIMP_ROOT, "lib", "skills", "book-to-skill", "SKILL.md"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        installed: true,
        skillPath: path.dirname(candidate),
        skillFile: candidate,
        installHint: null,
      };
    }
  }

  return {
    installed: false,
    skillPath: null,
    skillFile: null,
    installHint: "npx skills add virgiliojr94/book-to-skill",
    manualCloneHint: `git clone https://github.com/virgiliojr94/book-to-skill.git ${path.join(os.homedir(), ".agents", "skills", "book-to-skill")}`,
  };
}

export function probeLessonToSkill() {
  const candidates = [
    path.join(SHRIMP_ROOT, "lib", "skills", "leo-lesson-to-skill", "SKILL.md"),
    path.join(os.homedir(), ".agents", "skills", "leo-lesson-to-skill", "SKILL.md"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        installed: true,
        skillPath: path.dirname(candidate),
        skillFile: candidate,
      };
    }
  }

  return {
    installed: false,
    skillPath: null,
    skillFile: null,
  };
}

export function probeVoiceStudio(baseUrl = "http://127.0.0.1:3900") {
  const candidates = [
    path.join(os.homedir(), ".gemini", "config", "skills", "voicestudio", "SKILL.md"),
    path.join(os.homedir(), ".agents", "skills", "voicestudio", "SKILL.md"),
    path.join(SHRIMP_ROOT, "lib", "skills", "voicestudio", "SKILL.md"),
  ];

  let skillInstalled = false;
  let skillFile = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      skillInstalled = true;
      skillFile = candidate;
      break;
    }
  }

  let serviceOnline = false;
  let serviceInfo = null;
  try {
    const raw = execSync(`curl -s -m 1 "${baseUrl.replace(/\/+$/, "")}/health"`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    const parsed = JSON.parse(raw);
    if (parsed.status === "ok") {
      serviceOnline = true;
      serviceInfo = parsed;
    }
  } catch {
    serviceOnline = false;
  }

  return {
    endpoint: baseUrl,
    serviceOnline,
    serviceInfo,
    skillInstalled,
    skillFile,
    recommendedForAsr: true,
  };
}

export function classifyInput(rawInput) {
  if (!rawInput || typeof rawInput !== "string") {
    return { mode: "ambiguous", reason: "Input is empty or invalid" };
  }
  const trimmed = rawInput.trim();

  // 1. URL checks
  if (/^https?:\/\//i.test(trimmed)) {
    if (/bilibili\.com|youtube\.com|youtu\.be|douyin\.com/i.test(trimmed)) {
      return { mode: "lesson", type: "video_url", target: trimmed };
    }
    return { mode: "book", type: "web_article_or_doc", target: trimmed };
  }

  // 2. Video / Audio extensions
  const videoExts = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".m4v", ".mp3", ".wav", ".m4a"];
  const lower = trimmed.toLowerCase();
  if (videoExts.some((ext) => lower.endsWith(ext))) {
    return { mode: "lesson", type: "media_file", target: trimmed };
  }

  // 3. Document extensions
  const docExts = [
    ".pdf", ".epub", ".docx", ".rtf", ".txt", ".md", ".markdown", ".rst",
    ".adoc", ".asciidoc", ".html", ".htm", ".mobi", ".azw", ".azw3"
  ];
  if (docExts.some((ext) => lower.endsWith(ext))) {
    return { mode: "book", type: "document_file", target: trimmed };
  }

  // 4. Directory check
  const expanded = trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : path.resolve(trimmed);
  if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
    return { mode: "book", type: "directory_docs", target: expanded };
  }

  return { mode: "ambiguous", target: trimmed, reason: "Unrecognized format or path" };
}

export function probeAll() {
  const cfg = readConfig();
  const uvBin = checkBinary("uv");
  const pyEnv = probePythonEnv(cfg.python_venv_path);
  const bookSkill = probeBookToSkill();
  const lessonSkill = probeLessonToSkill();
  const voiceStudio = probeVoiceStudio();
  const ffmpegBin = checkBinary("ffmpeg");
  const ytdlpBin = checkBinary("yt-dlp");

  const outputDir = resolveOutputDir();
  const artifactsDir = resolveArtifactsDir();

  return {
    uv: { available: Boolean(uvBin), path: uvBin },
    pythonVenv: pyEnv,
    engines: {
      bookToSkill: bookSkill,
      lessonToSkill: lessonSkill,
    },
    asr: {
      defaultBackend: "voicestudio",
      voiceStudio: voiceStudio,
    },
    tools: {
      ffmpeg: { available: Boolean(ffmpegBin), path: ffmpegBin },
      ytdlp: { available: Boolean(ytdlpBin), path: ytdlpBin },
    },
    paths: {
      outputSkillsDir: outputDir,
      outputDirExists: fs.existsSync(outputDir),
      artifactsDir: artifactsDir,
      artifactsDirExists: fs.existsSync(artifactsDir),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = process.argv[2];
  if (arg === "classify" && process.argv[3]) {
    console.log(JSON.stringify(classifyInput(process.argv[3]), null, 2));
  } else {
    console.log(JSON.stringify(probeAll(), null, 2));
  }
}
