import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createModelDownloadPlan,
  downloadModelFromPlan,
  validateModelCandidate,
} from "../../lib/skills/leo-fooocus-imagine/scripts/fooocus_model_manager.mjs";

function safetensorsFixture() {
  const header = Buffer.from(JSON.stringify({ __metadata__: { format: "pt" } }), "utf8");
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([prefix, header]);
}

function setup(bytes = safetensorsFixture()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fooocus-model-download-"));
  const stateRoot = path.join(root, "state");
  const installation = {
    kind: "portable",
    root: path.join(root, "portable"),
    appRoot: path.join(root, "portable", "Fooocus"),
    python: path.join(root, "portable", "python_embeded", "python.exe"),
  };
  const candidate = validateModelCandidate({
    provider: "huggingface",
    repo: "example/test-sdxl",
    revision: "deadbeef",
    filename: "test.safetensors",
    type: "checkpoint",
    size: bytes.length,
    license: "openrail++",
    baseModel: "SDXL",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
  const plan = createModelDownloadPlan(candidate, installation, { stateRoot });
  return { root, stateRoot, installation, candidate, plan, bytes };
}

test("refuses every model download without explicit confirmation", async () => {
  const context = setup();
  await assert.rejects(
    downloadModelFromPlan(context.plan.id, { stateRoot: context.stateRoot, fetchFn: async () => new Response(context.bytes) }),
    /confirmation/i,
  );
  assert.equal(fs.existsSync(context.plan.destination), false);
  fs.rmSync(context.root, { recursive: true, force: true });
});

test("downloads, verifies, and atomically installs a confirmed safetensors file", async () => {
  const context = setup();
  const result = await downloadModelFromPlan(context.plan.id, {
    stateRoot: context.stateRoot,
    confirm: true,
    fetchFn: async () => new Response(context.bytes, { status: 200 }),
  });
  assert.equal(result.status, "installed");
  assert.deepEqual(fs.readFileSync(context.plan.destination), context.bytes);
  assert.equal(fs.existsSync(path.join(context.stateRoot, "model-downloads", `${context.plan.id}.partial`)), false);
  await assert.rejects(downloadModelFromPlan(context.plan.id, {
    stateRoot: context.stateRoot,
    confirm: true,
    fetchFn: async () => new Response(context.bytes, { status: 200 }),
  }), /already completed/i);
  fs.rmSync(context.root, { recursive: true, force: true });
});

test("resumes an interrupted download with an HTTP range request", async () => {
  const context = setup();
  const split = 12;
  const partialDir = path.join(context.stateRoot, "model-downloads");
  fs.mkdirSync(partialDir, { recursive: true });
  fs.writeFileSync(path.join(partialDir, `${context.plan.id}.partial`), context.bytes.subarray(0, split));
  let requestedRange;
  await downloadModelFromPlan(context.plan.id, {
    stateRoot: context.stateRoot,
    confirm: true,
    fetchFn: async (_url, options) => {
      requestedRange = options.headers.Range;
      return new Response(context.bytes.subarray(split), { status: 206 });
    },
  });
  assert.equal(requestedRange, `bytes=${split}-`);
  assert.deepEqual(fs.readFileSync(context.plan.destination), context.bytes);
  fs.rmSync(context.root, { recursive: true, force: true });
});

test("keeps an invalid download out of the Fooocus model directory", async () => {
  const invalid = Buffer.from("not a safetensors model");
  const context = setup(invalid);
  await assert.rejects(downloadModelFromPlan(context.plan.id, {
    stateRoot: context.stateRoot,
    confirm: true,
    fetchFn: async () => new Response(invalid, { status: 200 }),
  }), /safetensors/i);
  assert.equal(fs.existsSync(context.plan.destination), false);
  assert.equal(fs.existsSync(path.join(context.stateRoot, "model-downloads", `${context.plan.id}.partial`)), true);
  fs.rmSync(context.root, { recursive: true, force: true });
});
