import crypto from "node:crypto";
import fs from "node:fs";
import { setGlobalProxyFromEnv } from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const KNOWN_LICENSES = new Set([
  "apache-2.0", "mit", "openrail", "openrail++", "creativeml-openrail-m",
]);

export function configureEnvironmentProxy(env = process.env, setProxyFn = setGlobalProxyFromEnv) {
  const configured = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
    .some((name) => String(env[name] ?? "").trim());
  if (configured) setProxyFn();
  return configured;
}

configureEnvironmentProxy();

function managerStateRoot(options = {}) {
  return path.resolve(options.stateRoot ?? process.env.LEO_FOOOCUS_STATE_DIR ?? path.join(os.homedir(), ".leo-fooocus-imagine"));
}

function safeFilename(value) {
  const filename = String(value ?? "");
  if (!filename || path.basename(filename) !== filename || filename.includes("..") || /[\\/:*?"<>|]/.test(filename)) {
    throw new Error(`Unsafe model filename: ${filename}`);
  }
  if (!filename.toLowerCase().endsWith(".safetensors")) throw new Error("Only .safetensors model files are supported");
  return filename;
}

function normalizeLicense(value) {
  const license = String(value ?? "").trim().toLowerCase();
  if (!license || !KNOWN_LICENSES.has(license)) throw new Error("Model license is missing or unsupported");
  return license;
}

function normalizeBaseModel(value) {
  const base = String(value ?? "").trim();
  if (!/(^|[^a-z])sdxl([^a-z]|$)|stable-diffusion-xl/i.test(base)) throw new Error(`Model is not declared SDXL-compatible: ${base || "unknown"}`);
  return "SDXL";
}

export function validateModelCandidate(input) {
  if (input?.provider !== "huggingface") throw new Error("Only Hugging Face models are supported");
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(input.repo ?? ""))) throw new Error("Invalid Hugging Face repository id");
  const type = String(input.type ?? "").toLowerCase();
  if (!new Set(["checkpoint", "lora"]).has(type)) throw new Error("Model type must be checkpoint or lora");
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Model file size is required");
  const sha256 = input.sha256 == null ? null : String(input.sha256).toLowerCase();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid SHA-256 digest");
  return {
    provider: "huggingface",
    repo: String(input.repo),
    revision: String(input.revision ?? "main"),
    filename: safeFilename(input.filename),
    type,
    size,
    license: normalizeLicense(input.license),
    baseModel: normalizeBaseModel(input.baseModel),
    sha256,
    compatible: true,
  };
}

function baseFromMetadata(model) {
  const values = [
    model?.id,
    model?.cardData?.base_model,
    model?.cardData?.baseModel,
    model?.config?.diffusers?._class_name,
    ...(model?.tags ?? []),
  ].flat().filter(Boolean);
  return values.find((value) => /sdxl|stable-diffusion-xl/i.test(String(value))) ?? "";
}

export async function inspectHuggingFaceFile({ repo, file, type = "checkpoint", revision, fetchFn: inputFetchFn }, options = {}) {
  const fetchFn = options.fetchFn ?? inputFetchFn ?? fetch;
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo ?? ""))) throw new Error("Invalid Hugging Face repository id");
  const response = await fetchFn(`https://huggingface.co/api/models/${repo}/revision/${encodeURIComponent(revision ?? "main")}?blobs=true`, {
    headers: { Accept: "application/json" },
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 15000),
  });
  if (!response.ok) throw new Error(`Hugging Face metadata request failed: ${response.status} ${response.statusText}`);
  const model = await response.json();
  const sibling = (model.siblings ?? []).find((item) => item.rfilename === file);
  if (!sibling) throw new Error(`Model file is not present in the repository: ${file}`);
  const oid = String(sibling.lfs?.oid ?? sibling.oid ?? "");
  const sha256 = sibling.lfs?.sha256 ?? (oid.startsWith("sha256:") ? oid.slice(7) : null);
  return validateModelCandidate({
    provider: "huggingface",
    repo: model.id ?? repo,
    revision: model.sha ?? revision,
    filename: sibling.rfilename,
    type,
    size: sibling.lfs?.size ?? sibling.size,
    license: model.cardData?.license,
    baseModel: baseFromMetadata(model),
    sha256,
  });
}

export function modelDestination(installation, candidate) {
  const folder = candidate.type === "lora" ? "loras" : "checkpoints";
  const root = path.resolve(installation.appRoot, "models", folder);
  const destination = path.resolve(root, safeFilename(candidate.filename));
  if (path.dirname(destination) !== root) throw new Error("Model destination escapes Fooocus model directory");
  return destination;
}

function stablePlanValue(plan) {
  return {
    id: plan.id,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    candidate: plan.candidate,
    destination: plan.destination,
    confirmationRequired: true,
  };
}

function planDigest(plan) {
  return crypto.createHash("sha256").update(JSON.stringify(stablePlanValue(plan))).digest("hex");
}

export function createModelDownloadPlan(candidateInput, installation, options = {}) {
  const candidate = validateModelCandidate(candidateInput);
  const now = Number(options.now ?? Date.now());
  const plan = {
    id: crypto.randomUUID(),
    createdAt: now,
    expiresAt: now + Number(options.ttlMs ?? 30 * 60 * 1000),
    candidate,
    destination: modelDestination(installation, candidate),
    confirmationRequired: true,
    status: "planned",
  };
  plan.digest = planDigest(plan);
  const dir = path.join(managerStateRoot(options), "model-plans");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${plan.id}.json`), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return plan;
}

export function readModelDownloadPlan(planId, options = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(planId ?? ""))) throw new Error("Invalid model download plan id");
  const file = path.join(managerStateRoot(options), "model-plans", `${planId}.json`);
  const plan = JSON.parse(fs.readFileSync(file, "utf8"));
  if (plan.digest !== planDigest(plan)) throw new Error("Model download plan digest does not match");
  if (plan.status === "completed") throw new Error("Model download plan is already completed");
  if (plan.status != null && plan.status !== "planned") throw new Error(`Model download plan has an invalid status: ${plan.status}`);
  if (Number(options.now ?? Date.now()) > plan.expiresAt) throw new Error("Model download plan has expired");
  return plan;
}

function markModelDownloadPlanCompleted(plan, options = {}) {
  const file = path.join(managerStateRoot(options), "model-plans", `${plan.id}.json`);
  const completed = { ...plan, status: "completed", completedAt: Number(options.now ?? Date.now()) };
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(completed, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

export async function validateSafetensorsFile(file) {
  const handle = await fs.promises.open(file, "r");
  try {
    const lengthBuffer = Buffer.alloc(8);
    if ((await handle.read(lengthBuffer, 0, 8, 0)).bytesRead !== 8) throw new Error("Safetensors file is truncated");
    const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
    const stat = await handle.stat();
    if (!Number.isSafeInteger(headerLength) || headerLength <= 1 || 8 + headerLength > stat.size) throw new Error("Invalid Safetensors header length");
    const header = Buffer.alloc(headerLength);
    await handle.read(header, 0, headerLength, 8);
    JSON.parse(header.toString("utf8"));
    return true;
  } finally {
    await handle.close();
  }
}

export async function downloadModelFromPlan(planId, options = {}) {
  if (options.confirm !== true) throw new Error("Explicit user confirmation is required before downloading a model");
  const plan = readModelDownloadPlan(planId, options);
  const destination = path.resolve(plan.destination);
  if (fs.existsSync(destination)) throw new Error(`Model destination already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partialDir = path.join(managerStateRoot(options), "model-downloads");
  fs.mkdirSync(partialDir, { recursive: true });
  const partial = path.join(partialDir, `${plan.id}.partial`);
  const existing = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  const url = `https://huggingface.co/${plan.candidate.repo}/resolve/${encodeURIComponent(plan.candidate.revision)}/${plan.candidate.filename}`;
  const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
  const response = await (options.fetchFn ?? fetch)(url, { headers, redirect: "follow", signal: options.signal });
  if (!response.ok || !response.body) throw new Error(`Model download failed: ${response.status} ${response.statusText}`);
  if (existing > 0 && response.status !== 206) throw new Error("Server did not honor the resumable download range");
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial, { flags: existing > 0 ? "a" : "w" }));
  const size = fs.statSync(partial).size;
  if (size !== plan.candidate.size) throw new Error(`Downloaded model size mismatch: expected ${plan.candidate.size}, got ${size}`);
  if (plan.candidate.sha256 && await sha256File(partial) !== plan.candidate.sha256) throw new Error("Downloaded model SHA-256 mismatch");
  await validateSafetensorsFile(partial);
  fs.renameSync(partial, destination);
  markModelDownloadPlanCompleted(plan, options);
  return { status: "installed", planId, destination, candidate: plan.candidate, restartMayBeRequired: true };
}
