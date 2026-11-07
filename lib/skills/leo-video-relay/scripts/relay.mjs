#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { framesPublicByDefault, syncToCraft } from "./lib/craft.mjs";
import { runCheck } from "./lib/facts.mjs";
import { asrCandidates, exec, extractFrames, normalizeSubtitles, probe, toolExists, transcribe } from "./lib/media.mjs";
import {
  VIDEO_EXTS, expandHome, findPublished, findSkill, fmtTime, freeDirName, homeDir, listScenes, loadConfig, loadRegistry,
  moveDir, newRunId, readJson, saveConfig, saveRegistry, sha256File, slugify, workDir, writeJson,
} from "./lib/store.mjs";

const HELP = `leo-video-relay

  doctor                         检查依赖
  init <url|视频路径> [--force]   建立任务；已处理过的视频直接返回已有目录
  prepare <run_dir>              元数据、字幕、转写、抽帧（中断后重跑可续）
      [--redo asr,frames] [--max-interval 秒] [--scene-threshold 值] [--no-dedup]
      [--asr-tool 名称] [--asr-model 名称] [--language 语言]
  review <run_dir> --next        下一张待审拼图及格子与帧的对应关系
  review <run_dir> --sheet ID --note 文本     登记拼图已看（overview）
  review <run_dir> --detail ID,ID --note 文本 登记单帧已读（detail，才能作证据）
  review <run_dir> --blocked 原因             无法读图时登记
  check <run_dir>                校验 facts.draft.json，生成 facts.json 和 facts.md
  publish <run_dir> [--workspace 目录] [--copy-source]
  route list | route set <类型> [--workspace 目录] [--craft-folder 文件夹]
  scenes                         列出场景
  sync-craft <输出目录> --note 文件 [--folder 名称] [--upload-frames|--no-upload-frames] [--force] [--craft-api 目录]
`;

const OPTIONS = {
  force: { type: "boolean" }, next: { type: "boolean" }, "no-dedup": { type: "boolean" }, "copy-source": { type: "boolean" },
  "upload-frames": { type: "boolean" }, "no-upload-frames": { type: "boolean" }, help: { type: "boolean", short: "h" },
  redo: { type: "string" }, "max-interval": { type: "string" }, "scene-threshold": { type: "string" }, "asr-tool": { type: "string" },
  "asr-model": { type: "string" }, language: { type: "string" }, sheet: { type: "string" }, detail: { type: "string" }, note: { type: "string" },
  blocked: { type: "string" }, workspace: { type: "string" }, "craft-folder": { type: "string" }, folder: { type: "string" }, "craft-api": { type: "string" },
};

const print = (data) => console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
const fail = (message, code = 1) => { console.error(`错误：${message}`); process.exit(code); };

// ---------------- run helpers ----------------

function resolveRun(arg) {
  if (!arg) fail("缺少 run_dir");
  const dir = fs.existsSync(arg) ? path.resolve(arg) : path.join(workDir(), arg);
  if (!fs.existsSync(path.join(dir, "run.json"))) fail(`${arg} 不是任务目录`);
  return { dir, run: readJson(path.join(dir, "run.json")) };
}

const saveRun = (dir, run) => writeJson(path.join(dir, "run.json"), run);

function findResumable(input) {
  if (!fs.existsSync(workDir())) return null;
  for (const name of fs.readdirSync(workDir())) {
    const file = path.join(workDir(), name, "run.json");
    if (fs.existsSync(file) && readJson(file).input === input) return path.join(workDir(), name);
  }
  return null;
}

function createRun(fields) {
  const id = newRunId();
  const dir = path.join(workDir(), id);
  fs.mkdirSync(path.join(dir, "subtitles"), { recursive: true });
  saveRun(dir, { run_id: id, created_at: new Date().toISOString(), ...fields });
  return dir;
}

function findDownloadedSource(dir) {
  return fs.readdirSync(dir).filter((f) => f.startsWith("source.")).map((f) => path.join(dir, f))
    .find((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase())) || null;
}

function buildVideo(run, info, media) {
  return {
    id: run.video_id,
    source_type: run.source_type,
    url: run.url || null,
    local_path: run.local_path || null,
    source_file: run.source_type === "url" && run.source ? path.basename(run.source) : null,
    sha256: run.sha256 || null,
    title: info?.title || (run.local_path ? path.basename(run.local_path, path.extname(run.local_path)) : null),
    author: info?.uploader || info?.channel || null,
    published_at: info?.upload_date || null,
    availability: info?.availability || null,
    duration: media.duration,
    width: media.width,
    height: media.height,
    description: info?.description ? String(info.description).slice(0, 1000) : null,
    chapters: info?.chapters || null,
  };
}

// ---------------- commands ----------------

async function cmdInit([input], flags) {
  if (!input) fail("缺少视频链接或路径");
  const reg = loadRegistry();
  if (/^https?:\/\//i.test(input)) {
    const url = input.trim();
    const hit = !flags.force && findPublished(reg, { url });
    if (hit) return print({ status: "exists", dir: hit.dir, type: hit.type, video_status: hit.status });
    const resumable = !flags.force && findResumable(url);
    const dir = resumable || createRun({ input: url, source_type: "url", url });
    return print({
      status: resumable ? "resume" : "new",
      run_dir: dir,
      source_type: "url",
      yt_dlp_args: [
        "--no-playlist", "-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4",
        // Exact languages only: globs like "zh.*" or ".*-orig" pull dozens of translated and dubbed tracks and hit HTTP 429.
        // --ignore-errors keeps a failed subtitle from aborting the video; ASR always runs anyway.
        "--ignore-errors", "--write-info-json", "--write-subs", "--write-auto-subs", "--convert-subs", "srt",
        "--sub-langs", "zh-Hans,zh-Hant,zh-CN,zh-TW,zh,zh-orig,zh-Hans-orig,en,en-US,en-orig,ai-zh,-live_chat,-danmaku",
        "-o", path.join(dir, "source.%(ext)s"), url,
      ],
    });
  }

  const file = path.resolve(expandHome(input));
  if (!fs.existsSync(file)) fail(`找不到 ${file}`);
  if (fs.statSync(file).isDirectory()) {
    const videos = fs.readdirSync(file).filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase())).map((f) => path.join(file, f));
    return print({ status: "choose_video", directory: file, videos });
  }
  const sha256 = await sha256File(file);
  const id = `local:${sha256.slice(0, 16)}`;
  const hit = !flags.force && findPublished(reg, { id });
  if (hit) {
    if (hit.local_path !== file) {
      hit.local_path = file;
      saveRegistry(reg);
      const factsFile = path.join(hit.dir, "facts.json");
      const pack = readJson(factsFile);
      pack.video.local_path = file;
      writeJson(factsFile, pack);
    }
    return print({ status: "exists", dir: hit.dir, type: hit.type, video_status: hit.status });
  }
  const resumable = !flags.force && findResumable(file);
  const dir = resumable || createRun({ input: file, source_type: "local", local_path: file, sha256, video_id: id, source: file });
  return print({ status: resumable ? "resume" : "new", run_dir: dir, source_type: "local" });
}

async function cmdPrepare([arg], flags) {
  const { dir, run } = resolveRun(arg);
  const redo = new Set((flags.redo || "").split(",").filter(Boolean));
  let info = null;
  if (run.source_type === "url") {
    run.source = findDownloadedSource(dir);
    if (!run.source) fail(`${dir} 里没有 source.<ext>，请先用 leo-yt-dlp 下载（参数见 init 的 yt_dlp_args）`);
    const infoFile = path.join(dir, "source.info.json");
    if (!fs.existsSync(infoFile)) fail("缺少 source.info.json：下载时要带 --write-info-json");
    info = readJson(infoFile);
    run.video_id = `${String(info.extractor_key || info.extractor || "web").toLowerCase()}:${info.id}`;
    const hit = !flags.force && findPublished(loadRegistry(), { id: run.video_id });
    if (hit) {
      fs.rmSync(dir, { recursive: true, force: true });
      return print({ status: "exists", dir: hit.dir, type: hit.type, video_status: hit.status, note: "这个视频处理过，已删除本次下载" });
    }
  }
  if (run.source_type === "local" && !fs.existsSync(run.source)) fail(`原视频已不在 ${run.source}`);

  const auditFile = path.join(dir, "audit.json");
  const audit = readJson(auditFile, {});
  const media = probe(run.source);
  run.video = buildVideo(run, info, media);
  saveRun(dir, run);
  audit.duration = media.duration;
  audit.has_audio = media.hasAudio;
  audit.has_video = media.hasVideo;

  audit.subtitles = normalizeSubtitles(dir, run, info, media);
  writeJson(auditFile, audit);

  if (!audit.audio || audit.audio.status === "failed" || redo.has("asr")) {
    audit.audio = transcribe(dir, run, media, {
      tool: flags["asr-tool"],
      model: flags["asr-model"],
      language: flags.language || (info?.language ? String(info.language).split("-")[0] : undefined),
    });
    writeJson(auditFile, audit);
  }

  if (!media.hasVideo) {
    audit.frames = [];
    audit.sheets = [];
    audit.visual = { status: "blocked", reason: "视频没有画面轨" };
  } else if (!audit.frames || redo.has("frames")) {
    const result = await extractFrames(dir, run, media, {
      maxInterval: flags["max-interval"],
      sceneThreshold: flags["scene-threshold"],
      dedup: !flags["no-dedup"],
    });
    audit.frame_config = result.config;
    audit.cuts = result.cuts;
    audit.candidate_times = result.candidate_times;
    audit.frames = result.frames;
    audit.sheets = result.sheets;
    audit.visual = { status: "pending" };
  }
  writeJson(auditFile, audit);

  // Auto captions mostly repeat the ASR, so they are worth reading only when the ASR has nothing.
  const manual = audit.subtitles.filter((s) => s.source !== "platform_auto");
  const speechFiles = [
    audit.audio.segments ? "transcript.txt" : null,
    ...(audit.audio.segments ? manual : (manual.length ? manual : audit.subtitles).slice(0, 1)).map((s) => s.text),
  ].filter(Boolean);
  print({
    status: "prepared",
    run_dir: dir,
    video: { title: run.video.title, author: run.video.author, duration: fmtTime(media.duration), id: run.video_id },
    audio: audit.audio,
    subtitles: audit.subtitles.map(({ track, source, segments }) => ({ track, source, segments })),
    read_these: speechFiles,
    frames: { kept: audit.frames.length, candidates: audit.candidate_times?.length || 0, cuts: audit.cuts || 0, sheets: audit.sheets.length, max_interval: audit.frame_config?.max_interval },
  });
}

function nextSheet(audit) {
  const byId = new Map(audit.frames.map((f) => [f.id, f]));
  const index = audit.sheets.findIndex((s) => s.frames.some((c) => byId.get(c.frame_id).review === "none"));
  return index < 0 ? null : { index, sheet: audit.sheets[index] };
}

function cmdReview([arg], flags) {
  const { dir } = resolveRun(arg);
  const auditFile = path.join(dir, "audit.json");
  const audit = readJson(auditFile);
  if (!audit.frames) fail("请先运行 prepare");
  const byId = new Map(audit.frames.map((f) => [f.id, f]));
  const appendNote = (heading) => fs.appendFileSync(path.join(dir, "frames", "notes.md"), `## ${heading}\n${flags.note}\n\n`, "utf8");

  if (flags.next) {
    const found = nextSheet(audit);
    if (!found) return print(`全部 ${audit.sheets.length} 张拼图已审完。单帧通过 frames/<FRAME-ID>.jpg 读取。已有笔记：frames/notes.md`);
    const cells = found.sheet.frames.map((c) => `${c.cell} ${c.frame_id} ${fmtTime(c.t)}`).join("\n");
    return print(`进度：第 ${found.index + 1}/${audit.sheets.length} 张\n图片：${path.join(dir, found.sheet.path)}\nID：${found.sheet.id}\n${cells}`);
  }
  if (flags.blocked) {
    audit.visual = { status: "blocked", reason: flags.blocked };
    writeJson(auditFile, audit);
    return print({ visual: audit.visual });
  }
  if (!flags.sheet && !flags.detail) fail("需要 --next、--sheet、--detail 或 --blocked");
  if (!flags.note?.trim()) fail("--sheet 和 --detail 必须带 --note，写下看到了什么");

  if (flags.sheet) {
    const sheet = audit.sheets.find((s) => s.id === flags.sheet);
    if (!sheet) fail(`没有 ${flags.sheet}`);
    for (const cell of sheet.frames) {
      const frame = byId.get(cell.frame_id);
      if (frame.review === "none") frame.review = "overview";
    }
    const [first, last] = [sheet.frames[0], sheet.frames.at(-1)];
    appendNote(`${sheet.id} [${fmtTime(first.t)}-${fmtTime(last.t)}]`);
  }
  if (flags.detail) {
    const ids = flags.detail.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) fail(`没有这些帧：${unknown.join(", ")}`);
    for (const id of ids) byId.get(id).review = "detail";
    appendNote(ids.map((id) => `${id} [${fmtTime(byId.get(id).t)}]`).join(", "));
  }
  const pending = audit.frames.filter((f) => f.review === "none").length;
  if (!pending && audit.visual?.status !== "blocked") audit.visual = { status: "complete" };
  writeJson(auditFile, audit);
  print({ pending_frames: pending, detail_frames: audit.frames.filter((f) => f.review === "detail").length });
}

function cmdCheck([arg]) {
  const { dir, run } = resolveRun(arg);
  const result = runCheck(dir, run.video);
  if (!result.ok) {
    console.error(`未通过（${result.errors.length} 项）：\n${result.errors.map((e) => `- ${e}`).join("\n")}`);
    process.exit(1);
  }
  print({ status: result.pack.status, status_reasons: result.pack.status_reasons, type: result.pack.type, facts: result.pack.facts.length, sections: result.pack.sections.length, unconfirmed: result.pack.unconfirmed.length });
}

function cmdPublish([arg], flags) {
  const { dir, run } = resolveRun(arg);
  const result = runCheck(dir, run.video);
  if (!result.ok) fail(`事实包未通过校验：\n${result.errors.map((e) => `- ${e}`).join("\n")}`);
  if (result.pack.status === "failed") fail(`事实包状态为 failed，不发布：${result.pack.status_reasons.join("；")}`);

  const cfg = loadConfig();
  const route = cfg.routes[result.pack.type];
  const explicit = flags.workspace;
  if (!explicit && !route) {
    print({ status: "need_route", type: result.pack.type, known_types: Object.keys(cfg.routes), default_workspace_dir: cfg.default_workspace_dir });
    process.exit(3);
  }
  const workspace = expandHome(explicit || route.workspace_dir || cfg.default_workspace_dir);

  if (flags["copy-source"] && run.local_path) {
    const name = `source${path.extname(run.local_path)}`;
    fs.copyFileSync(run.local_path, path.join(dir, name));
    run.video.source_file = name;
    saveRun(dir, run);
    runCheck(dir, run.video);
  }

  const today = new Date().toLocaleDateString("sv");
  const target = freeDirName(workspace, `${today}-${slugify(result.pack.topic)}`);
  fs.mkdirSync(path.join(dir, "产出"), { recursive: true });
  moveDir(dir, target);

  const reg = loadRegistry();
  const previous = reg.videos[run.video_id];
  reg.videos[run.video_id] = {
    dir: target,
    type: result.pack.type,
    topic: result.pack.topic,
    status: result.pack.status,
    urls: [...new Set([...(previous?.urls || []), ...(run.url ? [run.url] : [])])],
    local_path: run.local_path || null,
    published_at: new Date().toISOString(),
  };
  saveRegistry(reg);
  print({ status: "published", dir: target, type: result.pack.type, workspace, video_status: result.pack.status, status_reasons: result.pack.status_reasons });
}

function cmdRoute([action, type], flags) {
  const cfg = loadConfig();
  if (action === "list" || !action) return print(cfg);
  if (action !== "set" || !type) fail("用法：route set <类型> [--workspace 目录] [--craft-folder 文件夹]");
  const route = cfg.routes[type] || {};
  route.workspace_dir = flags.workspace || route.workspace_dir || cfg.default_workspace_dir;
  if (flags["craft-folder"]) route.knowledge_target = { type: "craft", folder: flags["craft-folder"] };
  cfg.routes[type] = route;
  saveConfig(cfg);
  print({ type, ...route });
}

function cmdSyncCraft([arg], flags) {
  const dir = path.resolve(arg || "");
  const factsFile = path.join(dir, "facts.json");
  if (!fs.existsSync(factsFile)) fail(`${dir} 不是已发布的输出目录`);
  if (!flags.note) fail("缺少 --note");
  const notePath = path.resolve(flags.note);
  if (!fs.existsSync(notePath)) fail(`找不到 ${notePath}`);
  const pack = readJson(factsFile);
  const route = loadConfig().routes[pack.type];
  const uploadFrames = flags["upload-frames"] ? true : flags["no-upload-frames"] ? false : framesPublicByDefault(pack.video);
  const result = syncToCraft({ dir, notePath, folder: flags.folder || route?.knowledge_target?.folder, uploadFrames, force: flags.force, craftApiDir: flags["craft-api"] });
  print(result);
  if (!["synced", "already_synced"].includes(result.status)) process.exit(1);
}

function cmdDoctor() {
  const ffmpegFilters = exec("ffmpeg", ["-hide_banner", "-filters"]);
  const required = ["scdet", "tile"];
  const missingFilters = ffmpegFilters.missing ? required : required.filter((f) => !new RegExp(`\\b${f}\\b`).test(ffmpegFilters.stdout));
  const asr = asrCandidates().filter(toolExists);
  const report = {
    ffmpeg: !ffmpegFilters.missing && !missingFilters.length ? "ok" : `缺失：${ffmpegFilters.missing ? "ffmpeg" : missingFilters.join(", ")}（brew install ffmpeg / winget install ffmpeg）`,
    ffprobe: toolExists("ffprobe") ? "ok" : "缺失（随 ffmpeg 安装）",
    asr: asr.length ? asr : `缺失（Apple Silicon：uv tool install mlx-whisper；其他：uv tool install whisper-ctranslate2）`,
    "leo-yt-dlp": findSkill("leo-yt-dlp") || "同级目录未找到，处理网络视频前需要安装（本地视频不需要）",
    "leo-craft-api": findSkill("leo-craft-api") || "同级目录未找到，笔记同步 Craft 时需要（其他功能不需要）",
    data_dir: homeDir(),
  };
  print(report);
}

async function main() {
  const { values: flags, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true, strict: true });
  const [cmd, ...rest] = positionals;
  if (flags.help || !cmd) return print(HELP);
  const commands = {
    doctor: cmdDoctor, init: cmdInit, prepare: cmdPrepare, review: cmdReview, check: cmdCheck,
    publish: cmdPublish, route: cmdRoute, scenes: () => print(listScenes()), "sync-craft": cmdSyncCraft,
  };
  if (!commands[cmd]) fail(`未知命令 ${cmd}\n${HELP}`);
  await commands[cmd](rest, flags);
}

main().catch((err) => fail(err.message));
