#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, resolveConfigPath, resolveAuth, maskApiKey } from "./lib/config.mjs";
import { apiRequest, uploadImage } from "./lib/http.mjs";
import { OPERATIONS, buildPayload } from "./lib/operations.mjs";
import { extractTaskId, getTask, waitForTask, saveOutputs, PENDING_STATUSES } from "./lib/task.mjs";
import { findLocalFiles, mapLocalFiles, startShare } from "./lib/tunnel.mjs";

const UTILITY_COMMANDS = {
  status: "taskId",
  upload: "uploadPath",
  config: "configAction",
};

// "true"/"5"/'["a"]' -> JSON value; anything else stays a string
function parseValue(raw) {
  try { return JSON.parse(raw); } catch { return raw; }
}

export function parseCliArgs(argv) {
  const args = { command: "generate", imagePaths: [], set: {} };
  let i = 0;
  const first = argv[0];
  if (first && !first.startsWith("-")) {
    if (!OPERATIONS[first] && !UTILITY_COMMANDS[first]) throw new Error(`未知命令: ${first}`);
    args.command = first;
    i = 1;
    const positional = OPERATIONS[first]?.positional || UTILITY_COMMANDS[first];
    if (positional && argv[1] && !argv[1].startsWith("-")) { args[positional] = argv[1]; i = 2; }
  }

  for (; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--prompt") { args.prompt = val; i++; }
    else if (key === "--model") { args.model = val; i++; }
    else if (key === "--image" || key === "--images") {
      args.imagePaths.push(...String(val || "").split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    }
    else if (key === "--size") { args.size = val; i++; }
    else if (key === "--aspect-ratio") { args.aspectRatio = val; i++; }
    else if (key === "--duration") { args.duration = Number(val); i++; }
    else if (key === "--resolution") { args.resolution = val; i++; }
    else if (key === "--set") {
      const eq = String(val || "").indexOf("=");
      if (eq <= 0) throw new Error(`--set 需要 key=value 形式，收到: ${val}`);
      args.set[val.slice(0, eq)] = parseValue(val.slice(eq + 1));
      i++;
    }
    else if (key === "--idempotency-key") { args.idempotencyKey = val; i++; }
    else if (key === "--output-dir") { args.outputDir = val; i++; }
    else if (key === "--filename") { args.filename = val; i++; }
    else if (key === "--api-key") { args.apiKey = val; i++; }
    else if (key === "--api-url") { args.apiUrl = val; i++; }
    else if (key === "--default-model") { args.defaultModel = val; i++; }
    else if (key === "--no-wait") { args.noWait = true; }
    else if (key === "--dry-run") { args.dryRun = true; }
    else if (key === "--help" || key === "-h") { args.help = true; }
    else throw new Error(`未知参数: ${key}（模型专属字段请用 --set key=value）`);
  }
  return args;
}

// Video endpoints don't take base64: http(s) passes through, local files are uploaded (kept 72h).
function resolveImageUrls(auth, imagePaths, dryRun) {
  return imagePaths.map((p) => {
    if (/^https?:/i.test(p)) return p;
    if (/^data:/i.test(p)) throw new Error("视频接口不支持 base64 / data URI，请传本地路径或公网 URL");
    return dryRun ? `<upload:${path.resolve(p)}>` : uploadImage(auth, p);
  });
}

function report(task, args) {
  const { files } = saveOutputs(task, { outputDir: args.outputDir, filename: args.filename, seed: args.prompt });
  console.log(`\nSUCCESS: 任务 ${task.id || ""} 已完成`);
  for (const f of files) {
    if (f.kind === "text") {
      console.log(`文本结果已保存 ${f.path}（可直接作为下一步的 --prompt）:\n${f.text}`);
    } else {
      console.log(`${f.kind === "video" ? "视频" : "图片"}: ${f.path}`);
    }
  }
  if (files.some((f) => f.url)) console.log("远程链接约 24 小时有效，已下载到本地。");
}

async function runOperation(name, args) {
  const op = OPERATIONS[name];
  if (op.positional && !args[op.positional]) throw new Error(`用法: ${name} <${op.positional}> ...`);
  // no local --prompt check: most models require it, but e.g. MiniMax-H3-Regeneration only needs source_task_id
  const { auth, config } = resolveAuth(args);
  const model = args.model || (op.requireModel ? null : config.default_model);
  if (!model) throw new Error(op.requireModel ? `${name} 必须显式传 --model（与原任务一致）` : "缺少 --model（或先 config set --default-model）");

  let payload = buildPayload(args, model, resolveImageUrls(auth, args.imagePaths, args.dryRun));
  const urlPath = op.path(args);
  // Idempotency-Key: retrying with the same key + body never double-charges
  const idempotencyKey = args.idempotencyKey || randomUUID();
  // local files left in the payload (video_urls / audio_urls / --set ...) go out through a temporary tunnel
  const localFiles = findLocalFiles(payload);

  if (args.dryRun) {
    console.log(`[dry-run] POST ${auth.api_url}${urlPath}`);
    console.log(`Idempotency-Key: ${idempotencyKey}`);
    console.log(JSON.stringify(mapLocalFiles(payload, (f) => `<tunnel:${f}>`), null, 2));
    return;
  }
  if (localFiles.length > 0 && args.noWait) {
    throw new Error("本地文件通过临时隧道提供，隧道要保持到任务完成，不能与 --no-wait 同用");
  }

  let share = null;
  try {
    if (localFiles.length > 0) {
      share = await startShare(localFiles);
      payload = mapLocalFiles(payload, (f) => share.urls.get(f));
    }
    const taskId = submit(auth, name, urlPath, payload, idempotencyKey, Boolean(share));
    if (args.noWait) {
      console.log(`已提交。稍后执行 \`status ${taskId}\` 查询并下载。`);
      return;
    }
    report(await waitForTask(auth, taskId), args);
  } finally {
    share?.close();
  }
}

function submit(auth, name, urlPath, payload, idempotencyKey, viaTunnel) {
  console.log(`[leo-apimart-video] ${name} → ${urlPath} (${payload.model})，Idempotency-Key: ${idempotencyKey}`);
  let submitted;
  try {
    submitted = apiRequest(auth, "POST", urlPath, { json: payload, headers: { "Idempotency-Key": idempotencyKey } });
  } catch (err) {
    if (err.status === 0 || err.status === 409 || err.status >= 500) {
      // a retry gets a new tunnel URL, so the body can't be identical: check `status`/billing before resubmitting
      err.message += viaTunnel
        ? "\n结果不确定：重试会生成新的隧道地址（请求体不同，幂等键无法复用），重新提交前先在 APIMart 后台确认是否已建任务"
        : `\n结果不确定，请原样重试并带上同一个 key（不会重复扣费）: --idempotency-key ${idempotencyKey}`;
    }
    throw err;
  }
  const taskId = extractTaskId(submitted);
  if (!taskId) throw new Error(`提交响应中没有 task_id: ${JSON.stringify(submitted).slice(0, 300)}`);
  console.log(`[leo-apimart-video] task_id: ${taskId}`);
  return taskId;
}

async function runStatus(args) {
  if (!args.taskId) throw new Error("用法: status <task_id>");
  const { auth } = resolveAuth(args);
  const task = getTask(auth, args.taskId);
  if (task?.status === "completed") return report(task, args);
  if (args.noWait || !PENDING_STATUSES.has(task?.status)) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }
  report(await waitForTask(auth, args.taskId), args);
}

function runConfig(args) {
  const config = loadConfig();
  if (args.configAction === "set") {
    if (args.apiKey) config.api_key = args.apiKey;
    if (args.apiUrl) config.api_url = args.apiUrl;
    if (args.defaultModel) config.default_model = args.defaultModel;
    saveConfig(config);
    console.log(`已保存 ${resolveConfigPath()}`);
  } else if (args.configAction && args.configAction !== "get") {
    throw new Error("用法: config get | config set [--api-key k] [--api-url u] [--default-model m]");
  }
  const shown = loadConfig();
  console.log(JSON.stringify({ ...shown, api_key: maskApiKey(shown.api_key) }, null, 2));
}

function showHelp() {
  const ops = Object.entries(OPERATIONS)
    .map(([name, op]) => `  ${(name + (op.positional ? ` <${op.positional}>` : "")).padEnd(22)}${op.summary}`).join("\n");
  console.log(`leo-apimart-video — APIMart 视频生成

提交类命令（默认 generate，可省略）:
${ops}

工具命令:
  status <task_id>      查询 / 续等已提交的任务并下载结果
  upload <image_path>   上传本地图片，打印 URL（72 小时有效）
  config get | set      [--api-key k] [--api-url u] [--default-model m]

提交选项（直接映射为同名请求字段，模型用哪个以 SKILL.md 为准）:
  --model <m>             model（generate 缺省用 default_model）
  --prompt <text>         prompt（多数模型必填）
  --size <v>              size（如 16:9、1280x720）
  --aspect-ratio <v>      aspect_ratio
  --duration <秒>         duration（数字）
  --resolution <v>        resolution（如 720p）
  --images <a,b>          image_urls；本地文件自动上传
  --set key=value         任意字段，可多次；值按 JSON 解析（true / 5 / ["x"]）
                          值里的本地文件（如 video_urls='["./a.mp4"]'）自动经 cloudflared 临时隧道变成公网链接
  --idempotency-key <k>   重试时复用上次打印的 key（默认每次新生成）
  --output-dir <dir>      保存目录（默认 ./videos）
  --filename <name>       保存文件名（多个结果自动加 _1 _2）
  --no-wait               只提交，打印 task_id 后退出（不能与本地视频/音频同用）
  --dry-run               只打印请求，不上传不提交不扣费
  --api-key / --api-url   临时覆盖配置`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) return showHelp();
  if (OPERATIONS[args.command]) return runOperation(args.command, args);
  if (args.command === "status") return runStatus(args);
  if (args.command === "config") return runConfig(args);
  if (args.command === "upload") {
    if (!args.uploadPath) throw new Error("用法: upload <image_path>");
    console.log(uploadImage(resolveAuth(args).auth, args.uploadPath));
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] && fs.existsSync(process.argv[1]) ? fs.realpathSync(process.argv[1]) : "";
if (currentFile === invoked) {
  main().catch((err) => {
    console.error(`\nERROR: ${err.message || err}`);
    process.exit(1);
  });
}
