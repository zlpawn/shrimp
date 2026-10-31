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
  normalizeConfig,
  upsertProvider,
  pickProvider,
  registerModel,
  detectProviderType,
} from "../../lib/skills/leo-codex-imagine/scripts/leo_codex_imagine.mjs";
import * as apimart from "../../lib/skills/leo-codex-imagine/scripts/adapters/apimart.mjs";
import * as openai from "../../lib/skills/leo-codex-imagine/scripts/adapters/openai.mjs";
import * as codex from "../../lib/skills/leo-codex-imagine/scripts/adapters/codex.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("leo-codex-imagine SKILL.md exists and is valid", () => {
  const skillPath = path.join(ROOT, "lib", "skills", "leo-codex-imagine", "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  assert.match(content, /name: leo-codex-imagine/);
  assert.match(content, /gpt-image-2/);
});

test("leo-imagine-router SKILL.md and references exist", () => {
  const skillPath = path.join(ROOT, "lib", "skills", "leo-imagine-router", "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  assert.match(content, /name: leo-imagine-router/);
  assert.match(content, /scenes-gathered-zine-v1-3/);
  assert.match(content, /scene-distillation-zine-v1-3/);
  assert.match(content, /morandi-cinematic-poster-zeejay/);
  assert.match(content, /scenes-gathered-zine-live-flow-v1-0/);
  assert.match(content, /mono-color/);
  assert.match(content, /photo-abstract-editorial/);
  assert.match(content, /Scenario Discovery & Navigation/);

  const promptingPath = path.join(ROOT, "lib", "skills", "leo-imagine-router", "references", "prompting.md");
  assert.ok(fs.existsSync(promptingPath));

  const samplePath = path.join(ROOT, "lib", "skills", "leo-imagine-router", "references", "sample-prompts.md");
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

function withTempConfig(fn) {
  return async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-codex-test-"));
    const prevEnv = process.env.LEO_CODEX_CONFIG_PATH;
    process.env.LEO_CODEX_CONFIG_PATH = path.join(tmpDir, "config.json");
    try {
      await fn(process.env.LEO_CODEX_CONFIG_PATH);
    } finally {
      if (prevEnv !== undefined) process.env.LEO_CODEX_CONFIG_PATH = prevEnv;
      else delete process.env.LEO_CODEX_CONFIG_PATH;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

test("legacy flat config migrates into providers[]", () => {
  const cfg = normalizeConfig({ api_url: "https://api.example.com", api_key: "sk-old", model: "flux-schnell" });
  assert.deepEqual(cfg.providers, [
    { name: "api.example.com", api_url: "https://api.example.com", api_key: "sk-old", models: ["flux-schnell"] },
  ]);
  assert.equal(cfg.default_model, "flux-schnell");
});

test("config save/load round-trips providers and upsert merges models", withTempConfig((configPath) => {
  assert.deepEqual(loadSkillConfig().providers, []);

  let cfg = upsertProvider(loadSkillConfig(), { name: "mart", api_url: "https://api.mart.ai/v1", api_key: "sk-a", models: "m1,m2" });
  cfg = upsertProvider(cfg, { name: "mart", models: ["m2", "m3"] });
  assert.throws(() => upsertProvider(cfg, { name: "nokey", api_url: "https://x.com" }), /缺少 API Key/);
  saveSkillConfig(cfg);

  const reloaded = loadSkillConfig();
  assert.equal(reloaded.providers.length, 1);
  assert.deepEqual(reloaded.providers[0].models, ["m1", "m2", "m3"]);
  assert.equal(reloaded.providers[0].api_key, "sk-a");
  assert.ok(reloaded.updated_at);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
}));

test("pickProvider never guesses the provider from the model", () => {
  const cfg = normalizeConfig({
    providers: [
      { name: "a", api_url: "https://a.com", api_key: "ka", models: ["shared", "x"] },
      { name: "b", api_url: "https://b.com", api_key: "kb", models: ["shared", "z"] },
    ],
    default_model: "z",
  });
  assert.throws(() => pickProvider(cfg, {}), /已配置多个服务商[\s\S]*- a \[openai\][\s\S]*- b \[openai\]/);
  assert.throws(() => pickProvider(cfg, { model: "shared" }), /已配置多个服务商/);
  assert.deepEqual(
    [pickProvider(cfg, { provider: "b", model: "shared" }).provider.name, pickProvider(cfg, { provider: "b", model: "shared" }).model],
    ["b", "shared"],
  );
  assert.equal(pickProvider(cfg, { provider: "b" }).model, "z");
  assert.equal(pickProvider(cfg, { provider: "a" }).model, "shared");
  assert.throws(() => pickProvider(cfg, { provider: "nope" }), /未找到/);

  const single = normalizeConfig({ providers: [{ name: "only", api_url: "https://o.com", api_key: "k", models: ["m"] }] });
  assert.equal(pickProvider(single, {}).provider.name, "only");
  assert.equal(pickProvider(single, { model: "new" }).model, "new");
  assert.equal(pickProvider(normalizeConfig({}), {}), null);
});

test("registerModel records a newly used model once", withTempConfig(() => {
  saveSkillConfig({ providers: [{ name: "a", api_url: "https://a.com", api_key: "ka", models: ["x"] }] });
  assert.equal(registerModel("a", "y"), true);
  assert.equal(registerModel("a", "y"), false);
  assert.equal(registerModel("missing", "y"), false);
  assert.deepEqual(loadSkillConfig().providers[0].models, ["x", "y"]);
}));

test("resolveAuthAndEndpoint ignores environment variables and prioritizes CLI over config", withTempConfig(async () => {
  const prevOpenaiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-env-key-should-be-ignored";
  try {
    saveSkillConfig({
      providers: [
        { name: "one", api_url: "https://config-api.com", api_key: "sk-config-key", models: ["config-model"] },
        { name: "two", api_url: "https://two.com/v1", api_key: "sk-two", models: ["two-model"] },
      ],
    });

    await assert.rejects(resolveAuthAndEndpoint({}), /已配置多个服务商/);
    const fromConfig = await resolveAuthAndEndpoint({ provider: "one" });
    assert.equal(fromConfig.authType, "api-key");
    assert.equal(fromConfig.apiKey, "sk-config-key");
    assert.equal(fromConfig.targetUrl, "https://config-api.com/v1/images/generations");
    assert.equal(fromConfig.model, "config-model");

    const byModel = await resolveAuthAndEndpoint({ provider: "two", model: "two-model" });
    assert.equal(byModel.providerName, "two");
    assert.equal(byModel.targetUrl, "https://two.com/v1/images/generations");

    const fromCli = await resolveAuthAndEndpoint({ apiKey: "sk-cli-override", apiUrl: "https://cli-api.com", model: "cli-model" });
    assert.equal(fromCli.apiKey, "sk-cli-override");
    assert.equal(fromCli.targetUrl, "https://cli-api.com/v1/images/generations");
    assert.equal(fromCli.model, "cli-model");

    const urlOnly = await resolveAuthAndEndpoint({ apiUrl: "https://two.com/v1/" });
    assert.equal(urlOnly.apiKey, "sk-two");
  } finally {
    if (prevOpenaiKey !== undefined) process.env.OPENAI_API_KEY = prevOpenaiKey;
    else delete process.env.OPENAI_API_KEY;
  }
}));

test("detectProviderType: explicit type wins, apimart host auto-detected, else openai", () => {
  assert.equal(detectProviderType({ api_url: "https://api.apimart.ai/v1" }), "apimart");
  assert.equal(detectProviderType({ api_url: "https://api.xinglan.me" }), "openai");
  assert.equal(detectProviderType({ api_url: "https://api.apimart.ai/v1", type: "openai" }), "openai");
});

test("apimart payload: ratio in size, image_urls, no quality/response_format by default", () => {
  const auth = { model: "grok-imagine-2.0-ext" };
  const p = apimart.buildPayload(auth, { prompt: "hi", aspectRatio: "16:9" }, ["https://x/a.png", "data:image/png;base64,AA"]);
  assert.equal(p.size, "16:9");
  assert.deepEqual(p.image_urls, ["https://x/a.png", "data:image/png;base64,AA"]);
  assert.equal("quality" in p, false);
  assert.equal("response_format" in p, false);
  assert.equal(apimart.buildPayload(auth, { prompt: "hi", aspectRatio: "16:9", size: "1024x1024" }).size, "1024x1024");
  assert.equal("size" in apimart.buildPayload(auth, { prompt: "hi", aspectRatio: "auto" }), false);
});

test("openai payload: ratio mapped to legal pixel size, refs routed to edits", () => {
  assert.equal(openai.buildPayload({ model: "gpt-image-1" }, { prompt: "hi", aspectRatio: "16:9" }).size, "1536x1024");
  assert.equal(openai.buildPayload({ model: "dall-e-3" }, { prompt: "hi", aspectRatio: "9:16" }).size, "1024x1792");
  assert.equal(openai.buildPayload({ model: "gpt-image-1" }, { prompt: "hi" }).size, "auto");
  assert.deepEqual(openai.buildPayload({ model: "m" }, { prompt: "hi" }, ["data:x"]).image, ["data:x"]);
});

test("codex payload keeps input_images and aspect_ratio", () => {
  const p = codex.buildPayload({ model: "gpt-image-2" }, { prompt: "hi", aspectRatio: "1:1" }, ["data:x"]);
  assert.equal(p.size, "auto");
  assert.equal(p.aspect_ratio, "1:1");
  assert.deepEqual(p.input_images, [{ image_url: "data:x" }]);
});

test("extractImageResult handles sync, async submit, and finished task shapes", () => {
  assert.deepEqual(apimart.extractImageResult({ data: [{ b64_json: "AAA" }] }), { b64: "AAA" });
  assert.deepEqual(apimart.extractImageResult({ data: [{ url: "https://i/1.png" }] }), { url: "https://i/1.png" });
  const submit = apimart.extractImageResult({ code: 202, data: { id: "task_1", status: "pending", poll_url: "/v1/tasks/task_1" } });
  assert.equal(submit.taskId, "task_1");
  assert.equal(submit.pollUrl, "/v1/tasks/task_1");
  assert.equal(apimart.extractImageResult({ code: 200, data: [{ status: "submitted", task_id: "task_2" }] }).taskId, "task_2");
  assert.deepEqual(
    apimart.extractImageResult({ data: { id: "task_1", status: "completed", result: { images: [{ url: ["https://i/2.png"] }] } } }),
    { url: "https://i/2.png" },
  );
  assert.equal(apimart.extractImageResult({ data: { id: "task_1", status: "failed" } }).status, "failed");
  assert.equal(apimart.extractImageResult({ data: [] }), null);
});

test("resolveTaskUrl prefers poll_url and falls back to /v1/tasks/<id>", () => {
  const target = "https://api.apimart.ai/v1/images/generations";
  assert.equal(apimart.resolveTaskUrl(target, "t1", "/v1/tasks/t1"), "https://api.apimart.ai/v1/tasks/t1");
  assert.equal(apimart.resolveTaskUrl(target, "t1"), "https://api.apimart.ai/v1/tasks/t1");
});

test("leo-codex-imagine filename generator", () => {
  const slug = slugifyPrompt("赛博朋克城市");
  const filename = generateSemanticFilename("test", "png", "codex");
  assert.ok(filename.startsWith("codex_test_"));
  assert.ok(filename.endsWith(".png"));
});
