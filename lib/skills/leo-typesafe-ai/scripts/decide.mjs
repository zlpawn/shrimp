#!/usr/bin/env node

import fs from "node:fs";

export const PROVIDERS = Object.freeze({
  openrouter: Object.freeze({
    endpoint: "https://openrouter.ai/api/v1/systemone",
    model: "jev-latest",
    keyEnvs: ["LEO_TYPESAFE_API_KEY", "OPENROUTER_API_KEY"],
  }),
  typesafe: Object.freeze({
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    keyEnvs: ["LEO_TYPESAFE_API_KEY", "TYPESAFE_API_KEY"],
  }),
});

const TRANSIENT_STATUSES = new Set([429, 502, 503, 524, 529]);

export function parseArgs(argv) {
  const args = {
    provider: "openrouter",
    timeoutMs: 30_000,
    retries: 1,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    const requireValue = () => {
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${token}`);
      i += 1;
      return next;
    };

    if (token === "--provider") args.provider = requireValue();
    else if (token === "--url") args.url = requireValue();
    else if (token === "--model") args.model = requireValue();
    else if (token === "--api-key-env") args.apiKeyEnv = requireValue();
    else if (token === "--input") args.input = requireValue();
    else if (token === "--timeout-ms") args.timeoutMs = parsePositiveInteger(requireValue(), token);
    else if (token === "--retries") args.retries = parseNonNegativeInteger(requireValue(), token);
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function parsePositiveInteger(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInteger(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer`);
  return parsed;
}

export function resolveProviderConfig(args, env = process.env) {
  const provider = String(args.provider || "openrouter").toLowerCase();
  const preset = PROVIDERS[provider];

  if (!preset && provider !== "custom") {
    throw new Error(`Unsupported provider '${provider}'. Use openrouter, typesafe, or custom.`);
  }

  const endpoint = args.url || preset?.endpoint;
  if (!endpoint) throw new Error("Custom provider requires --url");

  let parsedUrl;
  try {
    parsedUrl = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint URL: ${endpoint}`);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
    throw new Error("Decision endpoint must use HTTPS unless it is localhost");
  }

  const keyEnvs = args.apiKeyEnv
    ? [args.apiKeyEnv]
    : (preset?.keyEnvs || ["LEO_TYPESAFE_API_KEY"]);
  const apiKeyEnv = keyEnvs.find((name) => env[name]);
  const apiKey = apiKeyEnv ? env[apiKeyEnv] : "";

  return {
    provider,
    endpoint: parsedUrl.toString(),
    model: args.model || preset?.model || "jev-latest",
    apiKey,
    apiKeyEnv: apiKeyEnv || keyEnvs[0],
    acceptedKeyEnvs: keyEnvs,
  };
}

export function validateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Request must be a JSON object");
  }
  if (!(typeof input.state === "string" || Array.isArray(input.state) || isPlainObject(input.state))) {
    throw new Error("Request.state must be a string, object, or array");
  }
  if (!isPlainObject(input.questions) || Object.keys(input.questions).length === 0) {
    throw new Error("Request.questions must be a non-empty object");
  }

  for (const [id, question] of Object.entries(input.questions)) {
    if (!isPlainObject(question)) throw new Error(`Question '${id}' must be an object`);
    if (!["choice", "noul", "score"].includes(question.type)) {
      throw new Error(`Question '${id}' has unsupported type '${question.type}'`);
    }
    if (question.instructions === undefined || question.instructions === null) {
      throw new Error(`Question '${id}' requires instructions`);
    }
    if (question.type === "choice" && (!isPlainObject(question.criteria) || Object.keys(question.criteria).length < 2)) {
      throw new Error(`Choice question '${id}' requires at least two criteria options`);
    }
    if (question.type === "score" && (!Array.isArray(question.criteria) || question.criteria.length < 2)) {
      throw new Error(`Score question '${id}' requires at least two ordered criteria levels`);
    }
  }

  return input;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildPayload(input, config, args = {}) {
  const validated = validateRequest(input);
  return {
    ...validated,
    model: args.model || validated.model || config.model,
  };
}

export async function readInput(inputPath, stdin = process.stdin) {
  if (inputPath) return JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  if (stdin.isTTY) throw new Error("Provide --input request.json or pipe JSON through stdin");

  let raw = "";
  for await (const chunk of stdin) raw += chunk;
  if (!raw.trim()) throw new Error("No JSON received on stdin");
  return JSON.parse(raw);
}

export async function requestDecision({
  config,
  payload,
  timeoutMs = 30_000,
  retries = 1,
  fetchImpl = fetch,
  wait = delay,
}) {
  if (!config.apiKey) {
    throw new Error(
      `Missing API key. Set ${config.acceptedKeyEnvs.join(" or ")}`,
    );
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const raw = await response.text();
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Decision API returned non-JSON HTTP ${response.status}: ${raw.slice(0, 300)}`);
      }

      if (response.ok) return body;

      const message = body?.error?.message || body?.message || JSON.stringify(body);
      const error = new Error(`Decision API HTTP ${response.status}: ${message}`);
      error.status = response.status;
      if (!TRANSIENT_STATUSES.has(response.status) || attempt >= retries) throw error;
      lastError = error;
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        lastError = new Error(`Decision API timed out after ${timeoutMs} ms`);
      } else {
        lastError = error;
      }
      if (attempt >= retries || (lastError.status && !TRANSIENT_STATUSES.has(lastError.status))) throw lastError;
    }

    await wait(Math.min(250 * (2 ** attempt), 2_000));
  }

  throw lastError || new Error("Decision API request failed");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`leo-typesafe-ai decision client

Usage:
  node scripts/decide.mjs --input request.json [options]
  Get-Content request.json -Raw | node scripts/decide.mjs [options]

Options:
  --provider openrouter|typesafe|custom  Provider preset (default: openrouter)
  --url URL                              Override endpoint; required for custom
  --model MODEL                          Override request model
  --api-key-env NAME                     Read the key from this environment variable
  --input FILE                           Read request JSON from a file; otherwise stdin
  --timeout-ms N                         Request timeout (default: 30000)
  --retries N                            Transient retries (default: 1)
  --dry-run                              Print resolved request without sending it
  --help                                 Show help

Recommended environment variable:
  LEO_TYPESAFE_API_KEY                   Key for the provider selected this run

Compatibility fallbacks:
  OPENROUTER_API_KEY                     OpenRouter only
  TYPESAFE_API_KEY                       TypeSafe official only
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = resolveProviderConfig(args);
  const input = await readInput(args.input);
  const payload = buildPayload(input, config, args);

  if (args.dryRun) {
    console.log(JSON.stringify({
      provider: config.provider,
      endpoint: config.endpoint,
      api_key_env: config.apiKeyEnv,
      has_api_key: Boolean(config.apiKey),
      payload,
    }, null, 2));
    return;
  }

  const result = await requestDecision({
    config,
    payload,
    timeoutMs: args.timeoutMs,
    retries: args.retries,
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  main().catch((error) => {
    console.error(`leo-typesafe-ai: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
