import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseCliArgs,
  slugifyPrompt,
  formatDateYYYYMMDDHHmmss,
  generateSemanticFilename,
  normalizeApiUrl,
  maskApiKey,
  resolveSkillConfigPath,
  loadSkillConfig,
  saveSkillConfig,
  resolveAuthAndEndpoint,
} from "../../lib/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("leo-codex-imagine SKILL.md and references exist", () => {
  const skillPath = path.join(ROOT, "lib", "skills", "leo-codex-imagine", "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  assert.match(content, /name: leo-codex-imagine/);
  assert.match(content, /references\/prompting\.md/);

  const promptingPath = path.join(ROOT, "lib", "skills", "leo-codex-imagine", "references", "prompting.md");
  assert.ok(fs.existsSync(promptingPath));

  const samplePath = path.join(ROOT, "lib", "skills", "leo-codex-imagine", "references", "sample-prompts.md");
  assert.ok(fs.existsSync(samplePath));
});

test("leo-codex-imagine script is valid ESM", () => {
  const scriptPath = path.join(ROOT, "lib", "skills", "leo-codex-imagine", "scripts", "leo_codex_imagine.mjs");
  assert.ok(fs.existsSync(scriptPath));
});

test("leo-codex-imagine parseCliArgs parser (generate options)", () => {
  const parsed = parseCliArgs([
    "--prompt", "test image",
    "--aspect-ratio", "16:9",
    "--quality", "high",
    "--api-url", "https://api.my-gateway.com",
    "--api-key", "sk-custom1234",
    "--model", "flux-pro"
  ]);
  assert.equal(parsed.command, "generate");
  assert.equal(parsed.prompt, "test image");
  assert.equal(parsed.aspectRatio, "16:9");
  assert.equal(parsed.quality, "high");
  assert.equal(parsed.apiUrl, "https://api.my-gateway.com");
  assert.equal(parsed.apiKey, "sk-custom1234");
  assert.equal(parsed.model, "flux-pro");
});

test("leo-codex-imagine parseCliArgs parser (config subcommands)", () => {
  const parsedSet = parseCliArgs([
    "config", "set",
    "--api-url", "https://api.oneapi.com",
    "--api-key", "sk-test999",
    "--model", "dall-e-3"
  ]);
  assert.equal(parsedSet.command, "config");
  assert.equal(parsedSet.configAction, "set");
  assert.equal(parsedSet.apiUrl, "https://api.oneapi.com");
  assert.equal(parsedSet.apiKey, "sk-test999");
  assert.equal(parsedSet.model, "dall-e-3");

  const parsedGet = parseCliArgs(["config", "get"]);
  assert.equal(parsedGet.command, "config");
  assert.equal(parsedGet.configAction, "get");
});

test("normalizeApiUrl handles base URLs, /v1, and full paths", () => {
  assert.equal(normalizeApiUrl("https://api.openai.com"), "https://api.openai.com/v1/images/generations");
  assert.equal(normalizeApiUrl("https://api.openai.com/"), "https://api.openai.com/v1/images/generations");
  assert.equal(normalizeApiUrl("https://my-proxy.com/v1"), "https://my-proxy.com/v1/images/generations");
  assert.equal(normalizeApiUrl("https://my-proxy.com/v1/"), "https://my-proxy.com/v1/images/generations");
  assert.equal(normalizeApiUrl("https://my-proxy.com/v1/images/generations"), "https://my-proxy.com/v1/images/generations");
});

test("maskApiKey masks sensitive keys safely", () => {
  assert.equal(maskApiKey(""), "");
  assert.equal(maskApiKey("short"), "********");
  assert.equal(maskApiKey("sk-1234567890abcdef"), "sk-1...cdef");
});

test("config load and save to custom config path", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-codex-test-"));
  const tmpConfig = path.join(tmpDir, "config.json");
  const prevEnv = process.env.LEO_CODEX_CONFIG_PATH;

  try {
    process.env.LEO_CODEX_CONFIG_PATH = tmpConfig;
    assert.deepEqual(loadSkillConfig(), {});

    const saved = saveSkillConfig({
      api_url: "https://api.example.com",
      api_key: "sk-savedkey123",
      model: "flux-schnell"
    });

    assert.equal(saved.api_url, "https://api.example.com");
    assert.equal(saved.api_key, "sk-savedkey123");
    assert.equal(saved.model, "flux-schnell");

    const reloaded = loadSkillConfig();
    assert.equal(reloaded.api_url, "https://api.example.com");
    assert.equal(reloaded.api_key, "sk-savedkey123");
    assert.equal(reloaded.model, "flux-schnell");
    assert.ok(reloaded.updated_at);
  } finally {
    if (prevEnv !== undefined) {
      process.env.LEO_CODEX_CONFIG_PATH = prevEnv;
    } else {
      delete process.env.LEO_CODEX_CONFIG_PATH;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveAuthAndEndpoint ignores environment variables and prioritizes CLI over config", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-codex-auth-test-"));
  const tmpConfig = path.join(tmpDir, "config.json");
  const prevConfigEnv = process.env.LEO_CODEX_CONFIG_PATH;
  const prevOpenaiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.LEO_CODEX_CONFIG_PATH = tmpConfig;
    // Set environment variable to verify it is completely ignored
    process.env.OPENAI_API_KEY = "sk-env-key-should-be-ignored";

    saveSkillConfig({
      api_url: "https://config-api.com",
      api_key: "sk-config-key",
      model: "config-model"
    });

    // 1. When config exists and no CLI args are provided, config is used (env var ignored!)
    const resolvedFromConfig = await resolveAuthAndEndpoint({});
    assert.equal(resolvedFromConfig.authType, "api-key");
    assert.equal(resolvedFromConfig.apiKey, "sk-config-key");
    assert.equal(resolvedFromConfig.targetUrl, "https://config-api.com/v1/images/generations");
    assert.equal(resolvedFromConfig.model, "config-model");

    // 2. When CLI args are provided, CLI overrides config
    const resolvedFromCli = await resolveAuthAndEndpoint({
      apiKey: "sk-cli-override",
      apiUrl: "https://cli-api.com",
      model: "cli-model"
    });
    assert.equal(resolvedFromCli.authType, "api-key");
    assert.equal(resolvedFromCli.apiKey, "sk-cli-override");
    assert.equal(resolvedFromCli.targetUrl, "https://cli-api.com/v1/images/generations");
    assert.equal(resolvedFromCli.model, "cli-model");
  } finally {
    if (prevConfigEnv !== undefined) {
      process.env.LEO_CODEX_CONFIG_PATH = prevConfigEnv;
    } else {
      delete process.env.LEO_CODEX_CONFIG_PATH;
    }
    if (prevOpenaiKey !== undefined) {
      process.env.OPENAI_API_KEY = prevOpenaiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("leo-codex-imagine filename generator", () => {
  const slug = slugifyPrompt("赛博朋克城市");
  const filename = generateSemanticFilename("test", "png", "codex");
  assert.ok(filename.startsWith("codex_test_"));
  assert.ok(filename.endsWith(".png"));
});
