#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const PYTHON_CLIENT = path.join(SCRIPT_DIR, "fooocus_gradio_client.py");
const DEFAULT_PORT = 7865;
const OFFICIAL_WINDOWS_URL = "https://github.com/lllyasviel/Fooocus/releases/download/v2.5.0/Fooocus_win64_2-5-0.7z";
const OFFICIAL_README_URL = "https://raw.githubusercontent.com/lllyasviel/Fooocus/main/readme.md";

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function parseCliArgs(argv = []) {
  const command = argv[0]?.startsWith("-") || !argv[0] ? "help" : argv[0];
  const options = {};
  const positionals = [];
  for (let i = command === "help" ? 0 : 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const rawKey = token.slice(2, eq >= 0 ? eq : undefined);
    const key = camelCase(rawKey);
    const assignOption = (value) => {
      if (options[key] === undefined) options[key] = value;
      else if (Array.isArray(options[key])) options[key].push(value);
      else options[key] = [options[key], value];
    };
    if (eq >= 0) {
      assignOption(parseValue(token.slice(eq + 1)));
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      assignOption(parseValue(argv[++i]));
    } else {
      assignOption(true);
    }
  }
  return { command, options, positionals };
}

function executableName(platform) {
  return platform === "win32" ? "python.exe" : "python";
}

function portableFrom(candidate, platform) {
  const appRoot = path.join(candidate, "Fooocus");
  const python = path.join(candidate, "python_embeded", executableName(platform));
  if (fs.existsSync(path.join(appRoot, "launch.py")) && fs.existsSync(python)) {
    return { kind: "portable", root: candidate, appRoot, python };
  }
  return null;
}

function sourceFrom(candidate, platform) {
  if (!fs.existsSync(path.join(candidate, "launch.py"))) return null;
  const pythonCandidates = platform === "win32"
    ? [path.join(candidate, ".venv", "Scripts", "python.exe"), path.join(candidate, "venv", "Scripts", "python.exe")]
    : [path.join(candidate, ".venv", "bin", "python"), path.join(candidate, "venv", "bin", "python")];
  const python = pythonCandidates.find((item) => fs.existsSync(item));
  return python ? { kind: "source", root: candidate, appRoot: candidate, python } : null;
}

export function defaultCandidateRoots({ platform = process.platform, homeDir = os.homedir() } = {}) {
  const roots = [];
  for (const item of [process.env.FOOOCUS_HOME, process.env.LEO_FOOOCUS_HOME]) {
    if (item) roots.push(path.resolve(item));
  }
  const managedInstallation = readState().installation;
  if (managedInstallation?.root) roots.push(path.resolve(managedInstallation.root));
  else if (managedInstallation?.appRoot) roots.push(path.resolve(managedInstallation.appRoot));
  if (platform === "win32") {
    for (const drive of ["C", "D", "E", "F"]) roots.push(`${drive}:\\Fooocus`);
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "FooocusAgent", "current"));
  } else {
    roots.push(path.join(homeDir, "Fooocus"), path.join(homeDir, ".local", "share", "fooocus"));
  }
  return [...new Set(roots)];
}

export function detectFooocusInstallations({ candidates, platform = process.platform } = {}) {
  const found = [];
  const seen = new Set();
  for (const candidate of candidates ?? defaultCandidateRoots({ platform })) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const resolved = path.resolve(candidate);
    const install = portableFrom(resolved, platform) ?? sourceFrom(resolved, platform);
    if (install && !seen.has(install.appRoot.toLowerCase())) {
      seen.add(install.appRoot.toLowerCase());
      found.push(install);
    }
  }
  return found;
}

export function buildInstallPlan({ existing = [], platform = process.platform, installRoot } = {}) {
  if (existing.length) return { action: "reuse", installation: existing[0] };
  if (platform === "win32") {
    return {
      action: "install",
      channel: "official-portable",
      sourceUrl: OFFICIAL_WINDOWS_URL,
      installRoot: installRoot ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "FooocusAgent", "current"),
      archiveFormat: "7z",
    };
  }
  return {
    action: "install",
    channel: "official-source",
    sourceUrl: "https://github.com/lllyasviel/Fooocus.git",
    installRoot: installRoot ?? path.join(os.homedir(), ".local", "share", "fooocus", "current"),
  };
}

export function extractOfficialWindowsDownload(markdown = "") {
  const match = String(markdown).match(/https:\/\/github\.com\/lllyasviel\/Fooocus\/releases\/download\/[^\s)"']+\/Fooocus_win64_[^\s)"']+\.7z/i);
  return match?.[0] ?? null;
}

async function resolveOfficialWindowsDownload() {
  try {
    const response = await fetch(OFFICIAL_README_URL, { signal: AbortSignal.timeout(15000) });
    if (response.ok) return extractOfficialWindowsDownload(await response.text()) ?? OFFICIAL_WINDOWS_URL;
  } catch {}
  return OFFICIAL_WINDOWS_URL;
}

function portIsFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

export async function findAvailablePort(preferred = DEFAULT_PORT, host = "127.0.0.1", attempts = 50) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = Number(preferred) + offset;
    if (await portIsFree(port, host)) return port;
  }
  throw new Error(`No available loopback port found in ${preferred}-${Number(preferred) + attempts - 1}`);
}

function appendNoProxy(value) {
  const parts = String(value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const host of ["127.0.0.1", "localhost", "::1"]) if (!parts.includes(host)) parts.push(host);
  return parts.join(",");
}

export function buildLaunchSpec(installation, { port = DEFAULT_PORT, env = process.env, platform = process.platform, extraArgs = [] } = {}) {
  const childEnv = { ...env };
  for (const key of ["ALL_PROXY", "all_proxy"]) delete childEnv[key];
  childEnv.NO_PROXY = appendNoProxy(childEnv.NO_PROXY ?? childEnv.no_proxy);
  childEnv.no_proxy = childEnv.NO_PROXY;
  const args = ["-u", path.join(installation.appRoot, "launch.py"), "--disable-in-browser", "--listen", "127.0.0.1", "--port", String(port), ...extraArgs];
  return {
    command: installation.python,
    args,
    cwd: installation.appRoot,
    env: childEnv,
    detached: true,
    windowsHide: platform === "win32",
  };
}

function componentLabel(component) {
  const props = component?.props ?? {};
  return `${props.label ?? ""} ${props.elem_id ?? ""}`.trim().toLowerCase();
}

function componentChoices(component) {
  return (component?.props?.choices ?? []).map((choice) => Array.isArray(choice) ? choice[1] ?? choice[0] : choice);
}

function findSemanticInput(components, inputIds, matchers) {
  for (const id of inputIds) {
    const label = componentLabel(components.get(id));
    if (matchers.some((matcher) => matcher.test(label))) return id;
  }
  return undefined;
}

export function discoverGenerationPlan(config) {
  const components = new Map((config.components ?? []).map((component) => [component.id, component]));
  const dependencies = config.dependencies ?? [];
  const prepareCandidates = dependencies
    .map((dependency, index) => ({ dependency, index }))
    .filter(({ dependency }) => (dependency.outputs ?? []).some((id) => components.get(id)?.type === "state") && (dependency.inputs ?? []).length >= 3);
  if (!prepareCandidates.length) throw new Error("Could not discover Fooocus task preparation API from /config");
  const scored = prepareCandidates.map((candidate) => {
    const inputIds = candidate.dependency.inputs ?? [];
    const prompt = findSemanticInput(components, inputIds, [/positive[_ ]?prompt/, /^prompt$/]);
    const model = findSemanticInput(components, inputIds, [/base model/]);
    return { ...candidate, score: inputIds.length + (prompt ? 1000 : 0) + (model ? 500 : 0) };
  });
  const prepare = scored.sort((a, b) => b.score - a.score)[0];
  const stateId = (prepare.dependency.outputs ?? []).find((id) => components.get(id)?.type === "state");
  const generationCandidates = dependencies
    .map((dependency, index) => ({ dependency, index }))
    .filter(({ dependency }) => (dependency.inputs ?? []).includes(stateId))
    .filter(({ dependency }) => {
      const types = (dependency.outputs ?? []).map((id) => components.get(id)?.type);
      return types.includes("gallery") && (types.includes("image") || types.includes("html"));
    });
  if (!generationCandidates.length) throw new Error("Could not discover Fooocus result generator API from /config");
  const generation = generationCandidates.sort((a, b) => (b.dependency.outputs?.length ?? 0) - (a.dependency.outputs?.length ?? 0))[0];
  const inputIds = prepare.dependency.inputs ?? [];
  return {
    prepareFn: prepare.index,
    generateFn: generation.index,
    stateId,
    inputIds,
    semanticInputs: {
      prompt: findSemanticInput(components, inputIds, [/positive[_ ]?prompt/, /^prompt$/]),
      negativePrompt: findSemanticInput(components, inputIds, [/negative prompt/]),
      baseModel: findSemanticInput(components, inputIds, [/base model/]),
      refinerModel: findSemanticInput(components, inputIds, [/refiner(?! switch)/]),
      aspectRatio: findSemanticInput(components, inputIds, [/aspect ratio/]),
      imageNumber: findSemanticInput(components, inputIds, [/image number/]),
      seed: findSemanticInput(components, inputIds, [/^seed$/]),
      performance: findSemanticInput(components, inputIds, [/^performance$/]),
      outputFormat: findSemanticInput(components, inputIds, [/output format/]),
      inputEnabled: findSemanticInput(components, inputIds, [/^input image$/]),
      inpaintPrompt: findSemanticInput(components, inputIds, [/inpaint additional prompt/]),
      outpaintDirections: findSemanticInput(components, inputIds, [/outpaint direction/]),
      styles: findSemanticInput(components, inputIds, [/selected styles/]),
    },
  };
}

export function discoverAdvancedCapabilities(config) {
  const components = new Map((config.components ?? []).map((component) => [component.id, component]));
  const values = [...components.values()];
  const labels = values.map(componentLabel);
  const capabilities = [];
  if (labels.some((label) => /^lora\s+\d+/i.test(label))) capabilities.push("lora");
  if (values.some((component) => component?.type === "radio"
    && componentChoices(component).some((choice) => ["pyracanny", "cpds", "faceswap"].includes(String(choice).toLowerCase())))) {
    capabilities.push("controlnet");
  }
  const describe = (config.dependencies ?? []).some((dependency) => {
    const inputLabels = (dependency.inputs ?? []).map((id) => componentLabel(components.get(id)));
    const outputLabels = (dependency.outputs ?? []).map((id) => componentLabel(components.get(id)));
    return dependency.trigger === "click"
      && inputLabels.some((label) => label.includes("content type"))
      && inputLabels.some((label) => label.includes("apply styles"))
      && outputLabels.some((label) => label.includes("positive_prompt"));
  });
  if (describe) capabilities.push("describe");
  if (labels.some((label) => label.includes("use with enhance"))
    && (labels.some((label) => label.includes("enhancement positive prompt"))
      || labels.some((label) => label === "enhance"))) capabilities.push("enhance");
  return capabilities;
}

export function discoverModelInventory(config) {
  const values = config.components ?? [];
  const choicesForLabel = (pattern) => values
    .filter((component) => pattern.test(componentLabel(component)))
    .flatMap(componentChoices)
    .map(String)
    .filter((value) => value && value.toLowerCase() !== "none");
  return {
    checkpoints: [...new Set(choicesForLabel(/^base model/))],
    refiners: [...new Set(choicesForLabel(/^refiner\s*\(/))],
    loras: [...new Set(choicesForLabel(/^lora\s+\d+/))],
  };
}

function stateRoot() {
  return process.env.LEO_FOOOCUS_STATE_DIR
    ? path.resolve(process.env.LEO_FOOOCUS_STATE_DIR)
    : path.join(os.homedir(), ".leo-fooocus-imagine");
}

function stateFile() {
  return path.join(stateRoot(), "state.json");
}

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return {}; }
}

function writeState(value) {
  fs.mkdirSync(stateRoot(), { recursive: true });
  fs.writeFileSync(stateFile(), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchJson(url, timeoutMs = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function health(url) {
  try {
    const config = await fetchJson(`${url}/config`);
    const plan = discoverGenerationPlan(config);
    return {
      ok: true,
      backend: "official-gradio",
      plan,
      advancedCapabilities: discoverAdvancedCapabilities(config),
      gradioVersion: config.version,
    };
  } catch {}
  try {
    const response = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) return { ok: true, backend: "fooocus-api" };
  } catch {}
  return { ok: false };
}

function emit(value, json = false) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

async function waitForHealth(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await health(url);
    if (result.ok) return result;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Fooocus did not become ready at ${url} within ${Math.round(timeoutMs / 1000)}s`);
}

function chooseInstall(options = {}) {
  const candidates = options.fooocusHome ? [path.resolve(options.fooocusHome)] : undefined;
  const found = detectFooocusInstallations({ candidates });
  if (!found.length) throw new Error("Fooocus is not installed. Run `leo-fooocus-imagine install` first or pass --fooocus-home.");
  return found[0];
}

async function startCommand(options = {}) {
  const current = readState();
  const preferredPort = Number(options.port ?? current.port ?? DEFAULT_PORT);
  const preferredUrl = options.url ?? current.url ?? `http://127.0.0.1:${preferredPort}`;
  let port = preferredPort;
  let url = preferredUrl;
  const currentHealth = await health(url);
  if (currentHealth.ok) return { status: "already-running", url, ...currentHealth };
  if (!options.url) {
    port = await findAvailablePort(preferredPort);
    url = `http://127.0.0.1:${port}`;
  }
  const install = chooseInstall(options);
  const spec = buildLaunchSpec(install, { port });
  fs.mkdirSync(stateRoot(), { recursive: true });
  const stdout = fs.openSync(path.join(stateRoot(), "fooocus.stdout.log"), "a");
  const stderr = fs.openSync(path.join(stateRoot(), "fooocus.stderr.log"), "a");
  const child = spawn(spec.command, spec.args, { ...spec, stdio: ["ignore", stdout, stderr] });
  child.unref();
  const state = {
    managed: true,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    executable: spec.command,
    commandArgs: spec.args,
    installation: install,
    port,
    url,
  };
  writeState(state);
  const ready = await waitForHealth(url, Number(options.timeout ?? 120) * 1000);
  return { status: "started", url, pid: child.pid, installation: install, ...ready };
}

async function processMatchesState(state) {
  if (!state?.managed || !Number.isInteger(state.pid)) return false;
  try {
    if (process.platform === "win32") {
      const script = `$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${state.pid}\" -ErrorAction SilentlyContinue; if($p){$p.ExecutablePath; $p.CommandLine}`;
      const result = await new Promise((resolve) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
        let output = "";
        child.stdout.on("data", (chunk) => { output += chunk; });
        child.on("close", () => resolve(output));
      });
      return result.toLowerCase().includes(String(state.executable).toLowerCase()) && result.includes("launch.py");
    }
    process.kill(state.pid, 0);
    return true;
  } catch { return false; }
}

async function stopCommand() {
  const state = readState();
  if (!state.managed) return { status: "not-managed", message: "No Fooocus process managed by this skill." };
  if (!(await processMatchesState(state))) return { status: "stale-state", message: "Managed PID no longer matches Fooocus; nothing was stopped." };
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const child = spawn("taskkill.exe", ["/PID", String(state.pid), "/T"], { windowsHide: true, stdio: "ignore" });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`taskkill exited ${code}`)));
    });
  } else {
    process.kill(-state.pid, "SIGTERM");
  }
  writeState({ ...state, managed: false, stoppedAt: new Date().toISOString() });
  return { status: "stopped", pid: state.pid };
}

function pythonArgsForGenerate(options, url) {
  const args = [PYTHON_CLIENT, "generate", "--url", url, "--prompt", String(options.prompt ?? "")];
  const mappings = {
    negative: "--negative", model: "--model", refiner: "--refiner", aspectRatio: "--aspect-ratio",
    count: "--count", seed: "--seed", performance: "--performance", outputFormat: "--output-format",
    outputDir: "--output-dir", mode: "--mode", input: "--input", mask: "--mask", inpaintPrompt: "--inpaint-prompt",
    outpaint: "--outpaint", uovMethod: "--uov-method", styles: "--styles",
  };
  for (const [key, flag] of Object.entries(mappings)) if (options[key] !== undefined) args.push(flag, String(options[key]));
  for (const value of Array.isArray(options.lora) ? options.lora : options.lora !== undefined ? [options.lora] : []) {
    args.push("--lora", String(value));
  }
  for (const value of Array.isArray(options.control) ? options.control : options.control !== undefined ? [options.control] : []) {
    args.push("--control", String(value));
  }
  if (options.json) args.push("--json");
  return args;
}

function pythonArgsForDescribe(options, url) {
  const args = [PYTHON_CLIENT, "describe", "--url", url, "--input", String(options.input ?? "")];
  if (options.contentType !== undefined) args.push("--content-type", String(options.contentType));
  if (options.applyStyles === false || options.applyStyles === "false") args.push("--no-apply-styles");
  if (options.json) args.push("--json");
  return args;
}

function pythonArgsForEnhance(options, url) {
  const args = [PYTHON_CLIENT, "enhance", "--url", url, "--input", String(options.input ?? "")];
  const mappings = {
    prompt: "--prompt", negative: "--negative", detectionPrompt: "--detection-prompt",
    maskModel: "--mask-model", samModel: "--sam-model", boxThreshold: "--box-threshold",
    textThreshold: "--text-threshold", maxDetections: "--max-detections", outputDir: "--output-dir",
    model: "--model", refiner: "--refiner", performance: "--performance", seed: "--seed",
  };
  for (const [key, flag] of Object.entries(mappings)) if (options[key] !== undefined) args.push(flag, String(options[key]));
  for (const value of Array.isArray(options.lora) ? options.lora : options.lora !== undefined ? [options.lora] : []) {
    args.push("--lora", String(value));
  }
  if (options.json) args.push("--json");
  return args;
}

async function runPython(install, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ALL_PROXY;
    delete env.all_proxy;
    env.NO_PROXY = appendNoProxy(env.NO_PROXY ?? env.no_proxy);
    env.no_proxy = env.NO_PROXY;
    const child = spawn(install.python, args, { cwd: install.appRoot, env, stdio: "inherit", windowsHide: true });
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Fooocus client exited with code ${code}`)));
  });
}

async function installCommand(options = {}) {
  const existing = detectFooocusInstallations({ candidates: options.fooocusHome ? [path.resolve(options.fooocusHome)] : undefined });
  const plan = buildInstallPlan({ existing, installRoot: options.installRoot });
  if (plan.action === "reuse") return { status: "reused", installation: plan.installation };
  if (options.dryRun) return { status: "planned", ...plan };
  if (plan.channel !== "official-portable") {
    throw new Error("Automatic source installation is not available on this platform yet; install official Fooocus and pass --fooocus-home.");
  }
  const target = path.resolve(plan.installRoot);
  if (fs.existsSync(target) && fs.readdirSync(target).length) {
    throw new Error(`Install target is not empty: ${target}`);
  }
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, ".fooocus-install-"));
  const archive = path.join(staging, "fooocus.7z");
  const sourceUrl = options.sourceUrl ?? process.env.LEO_FOOOCUS_DOWNLOAD_URL ?? await resolveOfficialWindowsDownload();
  try {
    const response = await fetch(sourceUrl, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
    const extractRoot = path.join(staging, "extract");
    fs.mkdirSync(extractRoot, { recursive: true });
    await new Promise((resolve, reject) => {
      const extractor = process.platform === "win32" ? "tar.exe" : "tar";
      const child = spawn(extractor, ["-xf", archive, "-C", extractRoot], { windowsHide: true, stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${extractor} could not extract the official .7z archive (exit ${code})`)));
    });
    const candidates = [extractRoot, ...fs.readdirSync(extractRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(extractRoot, entry.name))];
    const extracted = detectFooocusInstallations({ candidates });
    if (!extracted.length) throw new Error("Downloaded archive did not contain a recognizable Fooocus installation");
    const sourceRoot = extracted[0].root;
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(sourceRoot, target, { recursive: true, force: false, errorOnExist: true });
    const installed = detectFooocusInstallations({ candidates: [target] });
    if (!installed.length) throw new Error("Fooocus installation verification failed after extraction");
    return { status: "installed", sourceUrl, installation: installed[0] };
  } catch (error) {
    if (fs.existsSync(target) && fs.readdirSync(target).length === 0) fs.rmdirSync(target);
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function doctorCommand(options = {}) {
  const installs = detectFooocusInstallations({ candidates: options.fooocusHome ? [path.resolve(options.fooocusHome)] : undefined });
  const state = readState();
  const url = options.url ?? state.url ?? `http://127.0.0.1:${options.port ?? DEFAULT_PORT}`;
  const runtime = await health(url);
  return {
    installs,
    state,
    runtime,
    capabilities: runtime.ok
      ? ["text-to-image", "vary", "upscale", "inpaint", "outpaint", "image-prompt", ...(runtime.advancedCapabilities ?? [])]
      : [],
  };
}

async function modelsCommand(options = {}) {
  const current = readState();
  const url = options.url ?? current.url ?? `http://127.0.0.1:${options.port ?? DEFAULT_PORT}`;
  let runtime = await health(url);
  if (!runtime.ok) {
    const started = await startCommand(options);
    runtime = await health(started.url);
  }
  if (!runtime.ok) throw new Error("Fooocus is not available for model discovery");
  const config = await fetchJson(`${url}/config`);
  return { status: "success", backend: runtime.backend, ...discoverModelInventory(config) };
}

function helpText() {
  return `leo-fooocus-imagine — local Fooocus lifecycle and image generation\n\nCommands:\n  doctor [--json]\n  install [--fooocus-home PATH] [--install-root PATH] [--dry-run]\n  start [--fooocus-home PATH] [--port 7865]\n  status [--json]\n  capabilities [--json]\n  models [--json]\n  generate --prompt TEXT [--negative TEXT] [--model FILE] [--aspect-ratio RATIO]\n           [--mode text|vary|upscale|inpaint|outpaint|image-prompt] [--input FILE] [--mask FILE]\n           [--lora MODEL|WEIGHT]... [--control IMAGE|TYPE|STOP_AT|WEIGHT]...\n  describe --input FILE [--content-type Photograph,Anime] [--no-apply-styles]\n  enhance --input FILE [--detection-prompt TEXT] [--prompt TEXT] [--negative TEXT]\n  stop\n\nFooocus remains running after generation. Only use stop when the user explicitly asks to close it.`;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCliArgs(argv);
  if (command === "help" || options.help) return emit(helpText());
  if (command === "doctor") return emit(await doctorCommand(options), options.json);
  if (command === "install") return emit(await installCommand(options), options.json);
  if (command === "start") return emit(await startCommand(options), options.json);
  if (command === "status" || command === "capabilities") return emit(await doctorCommand(options), options.json);
  if (command === "models") return emit(await modelsCommand(options), options.json);
  if (command === "stop") return emit(await stopCommand(), options.json);
  if (command === "describe") {
    if (!options.input) throw new Error("--input is required for describe");
    const started = await startCommand(options);
    const install = started.installation ?? readState().installation ?? chooseInstall(options);
    await runPython(install, pythonArgsForDescribe(options, started.url));
    return;
  }
  if (command === "enhance") {
    if (!options.input) throw new Error("--input is required for enhance");
    const started = await startCommand(options);
    const install = started.installation ?? readState().installation ?? chooseInstall(options);
    await runPython(install, pythonArgsForEnhance(options, started.url));
    return;
  }
  if (command === "generate") {
    const mode = String(options.mode ?? "text").toLowerCase();
    if (!options.prompt && mode !== "upscale") throw new Error(`--prompt is required for ${mode}`);
    const started = await startCommand(options);
    const install = started.installation ?? readState().installation ?? chooseInstall(options);
    await runPython(install, pythonArgsForGenerate(options, started.url));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`leo-fooocus-imagine: ${error.message}`);
    process.exitCode = 1;
  });
}
