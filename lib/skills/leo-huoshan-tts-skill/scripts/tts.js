#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_ENDPOINT = "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional";
const DEFAULT_RESOURCE_ID = "seed-tts-2.0";
const DEFAULT_VOICE = "zh_female_vv_uranus_bigtts";
const DEFAULT_FORMAT = "mp3";
const DEFAULT_SAMPLE_RATE = 24000;

function printHelp() {
  console.log(`Ark TTS skill

Usage:
  node scripts/tts.js --text "你好，欢迎使用语音合成服务。"
  node scripts/tts.js --text-file ./script.txt --save-dir ./tts-out
  node scripts/tts.js --text "..." --api-key ark-xxxx --save-api-key

Options:
  --text <text>                Text to synthesize
  --text-file <path>           Read text from a file
  --voice <id>                 Voice / speaker id (default: ${DEFAULT_VOICE})
  --speaker <id>               Alias of --voice
  --format <mp3|wav|pcm>       Output format (default: ${DEFAULT_FORMAT})
  --sample-rate <number>       Sample rate (default: ${DEFAULT_SAMPLE_RATE})
  --output <path>              Exact output file path
  --save-dir <path>            Directory for timestamped output files
  --endpoint <url>             Override TTS endpoint
  --resource-id <id>           Override X-Api-Resource-Id
  --api-key <ark-...>          Use this API key for the current run
  --save-api-key               Save the provided API key for future runs
  --list-voices                Print the built-in recommended voices
  --help                       Show this help
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function validateArkKey(key) {
  if (!key || typeof key !== "string") {
    return { valid: false, reason: "API key is empty." };
  }
  const trimmed = key.trim();
  if (!trimmed.startsWith("ark-")) {
    return { valid: false, reason: 'API key must start with "ark-".' };
  }
  return { valid: true, key: trimmed };
}

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function readHermesApiKey() {
  const filePath = path.join(os.homedir(), ".hermes", "config.yaml");
  const content = readIfExists(filePath);
  if (!content) {
    return null;
  }
  const match = content.match(/^model:\s*(?:\r?\n.*)*?api_key:\s*["']?(ark-[^"'\s]+)["']?/m);
  if (!match) {
    return null;
  }
  const validation = validateArkKey(match[1]);
  return validation.valid ? validation.key : null;
}

function readClaudeApiKey() {
  const filePath = path.join(os.homedir(), ".claude", "settings.json");
  const content = readIfExists(filePath);
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    const value = parsed?.env?.ANTHROPIC_AUTH_TOKEN;
    const validation = validateArkKey(value);
    return validation.valid ? validation.key : null;
  } catch {
    return null;
  }
}

function readOpenClawApiKey() {
  const filePath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const content = readIfExists(filePath);
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    const providers = parsed?.models?.providers || {};
    for (const provider of Object.values(providers)) {
      const validation = validateArkKey(provider?.apiKey);
      if (validation.valid) {
        return validation.key;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readEnvApiKey() {
  const envNames = [
    "ANTHROPIC_AUTH_TOKEN",
    "API_KEY",
    "API_Key",
    "API_Keys",
    "api_key",
    "apiKey",
  ];
  for (const envName of envNames) {
    const validation = validateArkKey(process.env[envName]);
    if (validation.valid) {
      return validation.key;
    }
  }
  return null;
}

function saveApiKeyToHermes(apiKey) {
  const hermesDir = path.join(os.homedir(), ".hermes");
  const filePath = path.join(hermesDir, "config.yaml");
  if (!fs.existsSync(hermesDir)) {
    fs.mkdirSync(hermesDir, { recursive: true });
  }
  const current = readIfExists(filePath) || "";
  const mcpMatch = current.match(/(^|\r?\n)mcp_servers:\s*\{[\s\S]*$/m);
  const mcpBlock = mcpMatch ? mcpMatch[0].replace(/^\r?\n/, "") : "mcp_servers: {}";
  const nextContent = `model:\n  api_key: "${apiKey}"\n${mcpBlock.endsWith("\n") ? mcpBlock : `${mcpBlock}\n`}`;
  fs.writeFileSync(filePath, nextContent, "utf8");
  return filePath;
}

function resolveApiKey(args) {
  const explicit = args["api-key"];
  if (explicit) {
    const validation = validateArkKey(explicit);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
    if (args["save-api-key"]) {
      const savedPath = saveApiKeyToHermes(validation.key);
      return { apiKey: validation.key, source: `explicit+saved:${savedPath}` };
    }
    return { apiKey: validation.key, source: "explicit" };
  }

  const sources = [
    ["hermes", readHermesApiKey],
    ["claude", readClaudeApiKey],
    ["openclaw", readOpenClawApiKey],
    ["env", readEnvApiKey],
  ];

  for (const [sourceName, reader] of sources) {
    const apiKey = reader();
    if (apiKey) {
      return { apiKey, source: sourceName };
    }
  }

  throw new Error(
    'No valid Ark API key found. Provide --api-key ark-..., or configure ~/.hermes/config.yaml model.api_key.'
  );
}

function ensureText(args) {
  if (args["text"] && args["text-file"]) {
    throw new Error("Use only one of --text or --text-file.");
  }
  if (args["text"]) {
    return args["text"].trim();
  }
  if (args["text-file"]) {
    const filePath = path.resolve(args["text-file"]);
    const content = fs.readFileSync(filePath, "utf8");
    return content.trim();
  }
  throw new Error("Missing text. Provide --text or --text-file.");
}

function pickOutputPath(args, format) {
  if (args.output) {
    return path.resolve(args.output);
  }
  const saveDir = path.resolve(args["save-dir"] || path.join(process.cwd(), "tts-out"));
  fs.mkdirSync(saveDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(saveDir, `tts-${stamp}.${format}`);
}

function parseSampleRate(value) {
  if (value === undefined) {
    return DEFAULT_SAMPLE_RATE;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Sample rate must be a positive integer.");
  }
  return parsed;
}

function listVoices() {
  const voices = [
    "zh_female_vv_uranus_bigtts",
    "zh_female_gaolengyujie_uranus_bigtts",
    "zh_male_rap_uranus_bigtts",
    "en_female_sarah_bigtts",
  ];
  console.log(JSON.stringify({ voices }, null, 2));
}

async function collectStream(response) {
  if (!response.body) {
    throw new Error("Response body is empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  const audioChunks = [];
  const events = [];
  let usage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const event = JSON.parse(trimmed);
      events.push(event);
      if (event.usage) {
        usage = event.usage;
      }
      if (event.code === 0 && event.data) {
        audioChunks.push(Buffer.from(event.data, "base64"));
      } else if (event.code && event.code !== 20000000) {
        throw new Error(event.message || `TTS API error code ${event.code}`);
      }
    }
  }

  const trailing = pending.trim();
  if (trailing) {
    const event = JSON.parse(trailing);
    events.push(event);
    if (event.usage) {
      usage = event.usage;
    }
    if (event.code === 0 && event.data) {
      audioChunks.push(Buffer.from(event.data, "base64"));
    } else if (event.code && event.code !== 20000000) {
      throw new Error(event.message || `TTS API error code ${event.code}`);
    }
  }

  return {
    audioBuffer: Buffer.concat(audioChunks),
    events,
    usage,
  };
}

async function synthesize(options) {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "X-Api-Key": options.apiKey,
      "X-Api-Resource-Id": options.resourceId,
      "Content-Type": "application/json",
      "Connection": "keep-alive",
      "X-Control-Require-Usage-Tokens-Return": "*",
    },
    body: JSON.stringify({
      req_params: {
        text: options.text,
        speaker: options.voice,
        audio_params: {
          format: options.format,
          sample_rate: options.sampleRate,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  return collectStream(response);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args["list-voices"]) {
    listVoices();
    return;
  }

  const text = ensureText(args);
  if (!text) {
    throw new Error("Input text is empty after trimming.");
  }

  const voice = args.voice || args.speaker || DEFAULT_VOICE;
  const format = (args.format || DEFAULT_FORMAT).toLowerCase();
  const sampleRate = parseSampleRate(args["sample-rate"]);
  const endpoint = args.endpoint || DEFAULT_ENDPOINT;
  const resourceId = args["resource-id"] || DEFAULT_RESOURCE_ID;
  const { apiKey, source } = resolveApiKey(args);
  const outputPath = pickOutputPath(args, format);

  const result = await synthesize({
    apiKey,
    endpoint,
    resourceId,
    text,
    voice,
    format,
    sampleRate,
  });

  if (!result.audioBuffer.length) {
    throw new Error("No audio chunks were returned by the TTS API.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.audioBuffer);

  const payload = {
    success: true,
    file: outputPath,
    format,
    voice,
    sample_rate: sampleRate,
    endpoint,
    resource_id: resourceId,
    api_key_source: source,
    input_characters: text.length,
    bytes_written: result.audioBuffer.length,
    chunks_received: result.events.filter((event) => event.code === 0 && event.data).length,
    usage: result.usage,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
