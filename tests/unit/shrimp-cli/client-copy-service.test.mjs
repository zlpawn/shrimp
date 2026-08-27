import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addEndpoint } from "../../../lib/shrimp-cli/domain/endpoint-service.mjs";
import { addClient, copyClient, getClient, listClients, removeClient, renameClient } from "../../../lib/shrimp-cli/domain/client-service.mjs";

async function tempState() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "shrimp-copy-"));
  const configPath = path.join(dir, "gateway.config.json");
  const secretsPath = path.join(dir, "gateway.secrets.json");
  await writeFile(configPath, JSON.stringify({
    server: { host: "127.0.0.1", port: 8787 },
    clients: {
      code: { endpoints: [] },
      desktop: { endpoints: [] },
      codex: { endpoints: [] },
      deeptutor: { endpoints: [] },
    },
  }, null, 2));
  await writeFile(secretsPath, JSON.stringify({ api_keys: {} }, null, 2));
  return { dir, configPath, secretsPath };
}

test("replace copy clones endpoints and secrets with new ids", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  const source = addEndpoint({
    ...ctx,
    client: "codex",
    name: "ark",
    type: "openai-chat",
    base_url: "https://example.com/v1/chat/completions",
    api_key: "sk-codex",
  });
  const result = copyClient({
    ...ctx,
    from: "codex",
    to: "deeptutor",
    mode: "replace",
  });
  assert.equal(result.copied, 1);
  const target = getClient({ ...ctx, client: "deeptutor" });
  assert.equal(target.endpoint_count, 1);
  assert.notEqual(target.endpoints[0].id, source.endpoint.id);
});

test("fill-empty no-ops when target has endpoints", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addEndpoint({
    ...ctx,
    client: "codex",
    name: "ark",
    type: "openai-chat",
    base_url: "https://example.com/v1/chat/completions",
  });
  addEndpoint({
    ...ctx,
    client: "deeptutor",
    name: "existing",
    type: "openai-chat",
    base_url: "https://example.com/v1/chat/completions",
  });
  const result = copyClient({
    ...ctx,
    from: "codex",
    to: "deeptutor",
    mode: "fill-empty",
  });
  assert.equal(result.copied, 0);
  assert.equal(getClient({ ...ctx, client: "deeptutor" }).endpoint_count, 1);
});

test("merge keeps target endpoints and appends clones", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addEndpoint({
    ...ctx,
    client: "codex",
    name: "ark",
    type: "openai-chat",
    base_url: "https://example.com/v1/chat/completions",
  });
  addEndpoint({
    ...ctx,
    client: "deeptutor",
    name: "existing",
    type: "openai-chat",
    base_url: "https://example.com/v2/chat/completions",
  });
  const result = copyClient({
    ...ctx,
    from: "codex",
    to: "deeptutor",
    mode: "merge",
  });
  assert.equal(result.copied, 1);
  assert.equal(getClient({ ...ctx, client: "deeptutor" }).endpoint_count, 2);
});
test("addClient creates an empty client group when no copyFrom is given", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  const result = addClient({ ...ctx, client: "my-agent" });
  assert.equal(result.created, true);
  const target = getClient({ ...ctx, client: "my-agent" });
  assert.equal(target.endpoint_count, 0);
});

test("addClient seeds from another client when copyFrom is given", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addEndpoint({
    ...ctx,
    client: "codex",
    name: "ark",
    type: "openai-chat",
    base_url: "https://example.com/v1/chat/completions",
    api_key: "sk-codex",
  });
  const result = addClient({ ...ctx, client: "clone", copyFrom: "codex", mode: "replace" });
  assert.equal(result.copied, 1);
  const target = getClient({ ...ctx, client: "clone" });
  assert.equal(target.endpoint_count, 1);
  assert.notEqual(target.endpoints[0].id, getClient({ ...ctx, client: "codex" }).endpoints[0].id);
});

test("removeClient deletes a custom group and its endpoint secrets", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addClient({ ...ctx, client: "temp", copyFrom: "codex", mode: "replace" });
  assert.ok(getClient({ ...ctx, client: "temp" }));
  const result = removeClient({ ...ctx, client: "temp", yes: true });
  assert.equal(result.removed, "temp");
  assert.throws(() => getClient({ ...ctx, client: "temp" }), /Client not found: temp/);
});

test("removeClient refuses to run without explicit confirmation", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addClient({ ...ctx, client: "temp" });
  assert.throws(
    () => removeClient({ ...ctx, client: "temp" }),
    (err) => err?.code === "confirmation_required",
  );
  // Still present after a refused removal.
  assert.ok(getClient({ ...ctx, client: "temp" }));
});

test("addClient stamps the protocol onto the new group", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  const result = addClient({ ...ctx, client: "p-openai", protocol: "openai" });
  assert.equal(result.protocol, "openai");
  const target = getClient({ ...ctx, client: "p-openai" });
  assert.equal(target.endpoint_count, 0);
});

test("addClient inherits openai protocol when copying from codex", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addEndpoint({
    ...ctx,
    client: "codex",
    name: "ark",
    type: "openai-chat",
    base_url: "https://example.com/v1/chat/completions",
    api_key: "sk-codex",
  });
  const result = addClient({ ...ctx, client: "p-copy", copyFrom: "codex", mode: "replace" });
  assert.equal(result.protocol, "openai");
  // The protocol must be persisted on the group, not just returned.
  const { readFileSync } = await import("node:fs");
  const saved = JSON.parse(readFileSync(ctx.configPath, "utf8"));
  assert.equal(saved.clients["p-copy"].protocol, "openai");
});

test("addClient defaults to anthropic protocol for empty creates", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  const result = addClient({ ...ctx, client: "p-default" });
  assert.equal(result.protocol, "anthropic");
});

test("addClient persists displayName on the client group", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  const result = addClient({ ...ctx, client: "my-agent", displayName: "My Custom Agent" });
  assert.equal(result.created, true);
  assert.equal(result.display_name, "My Custom Agent");
  const target = getClient({ ...ctx, client: "my-agent" });
  assert.equal(target.display_name, "My Custom Agent");

  const { readFileSync } = await import("node:fs");
  const saved = JSON.parse(readFileSync(ctx.configPath, "utf8"));
  assert.equal(saved.clients["my-agent"].display_name, "My Custom Agent");
});

test("addClient falls back display_name to client when displayName is omitted", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  const result = addClient({ ...ctx, client: "plain-agent" });
  assert.equal(result.display_name, "plain-agent");
  const target = getClient({ ...ctx, client: "plain-agent" });
  assert.equal(target.display_name, "plain-agent");
});

test("listClients and getClient include display_name", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addClient({ ...ctx, client: "agent-1", displayName: "Agent One" });
  const list = listClients(ctx);
  const item = list.items.find((x) => x.client === "agent-1");
  assert.ok(item);
  assert.equal(item.display_name, "Agent One");

  // Built-in clients without explicit display_name fall back to their client name
  const codeItem = list.items.find((x) => x.client === "code");
  assert.ok(codeItem);
  assert.equal(codeItem.display_name, "code");
  const codeClient = getClient({ ...ctx, client: "code" });
  assert.equal(codeClient.display_name, "code");
});

test("renameClient updates display_name and saves config", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  addClient({ ...ctx, client: "custom-agent", displayName: "Original Name" });
  const result = renameClient({ ...ctx, client: "custom-agent", displayName: "Updated Name" });
  assert.equal(result.client, "custom-agent");
  assert.equal(result.display_name, "Updated Name");

  const target = getClient({ ...ctx, client: "custom-agent" });
  assert.equal(target.display_name, "Updated Name");

  const { readFileSync } = await import("node:fs");
  const saved = JSON.parse(readFileSync(ctx.configPath, "utf8"));
  assert.equal(saved.clients["custom-agent"].display_name, "Updated Name");
});

test("renameClient rejects built-in clients", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  for (const builtin of ["code", "desktop", "codex", "deeptutor"]) {
    assert.throws(
      () => renameClient({ ...ctx, client: builtin, displayName: "New Name" }),
      (err) => err?.code === "builtin_client" || /built-in/i.test(err?.message),
    );
  }
});

test("renameClient rejects non-existent client or invalid displayName", async (t) => {
  const ctx = await tempState();
  t.after(() => rm(ctx.dir, { recursive: true, force: true }));
  assert.throws(
    () => renameClient({ ...ctx, client: "nonexistent", displayName: "New Name" }),
    (err) => err?.code === "client_not_found",
  );
  addClient({ ...ctx, client: "valid-agent" });
  assert.throws(
    () => renameClient({ ...ctx, client: "valid-agent", displayName: "   " }),
    (err) => err?.code === "missing_fields",
  );
});
