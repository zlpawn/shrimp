import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  downloadModelCommand,
  inspectModelCommand,
  modelSelectionGuide,
} from "../../lib/skills/leo-fooocus-imagine/scripts/leo_fooocus_imagine.mjs";

function fixtureResponse() {
  return new Response(JSON.stringify({
    id: "example/photo-sdxl",
    sha: "deadbeef",
    cardData: { license: "openrail++", base_model: "stabilityai/stable-diffusion-xl-base-1.0" },
    tags: ["stable-diffusion-xl", "text-to-image"],
    siblings: [{ rfilename: "photo.safetensors", lfs: { size: 42, oid: `sha256:${"a".repeat(64)}` } }],
  }), { status: 200 });
}

test("model selection guide leaves creative judgment to the calling model", () => {
  const guide = modelSelectionGuide().join("\n");
  assert.match(guide, /medium/i);
  assert.match(guide, /subject/i);
  assert.match(guide, /use case/i);
  assert.match(guide, /style/i);
  assert.match(guide, /local/i);
  assert.doesNotMatch(guide, /hardcoded model|fixed model/i);
});

test("inspect-model returns verified facts and a confirmation-required plan", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fooocus-model-cli-"));
  const installation = { appRoot: path.join(temp, "Fooocus"), root: temp, kind: "portable", python: "python.exe" };
  const result = await inspectModelCommand({
    repo: "example/photo-sdxl", file: "photo.safetensors", type: "checkpoint",
  }, { installation, stateRoot: path.join(temp, "state"), fetchFn: async () => fixtureResponse() });
  assert.equal(result.status, "confirmation-required");
  assert.equal(result.model.repo, "example/photo-sdxl");
  assert.equal(result.model.size, 42);
  assert.equal(result.model.license, "openrail++");
  assert.equal(result.plan.confirmationRequired, true);
  assert.match(result.nextAction, /user confirmation/i);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("download-model refuses a plan when --confirm was not supplied", async () => {
  await assert.rejects(downloadModelCommand({ plan: "00000000-0000-0000-0000-000000000000" }, {}), /--confirm/i);
});
