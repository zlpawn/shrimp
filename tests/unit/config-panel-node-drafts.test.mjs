import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEndpointDrafts,
  buildNodeSaveConfig,
  buildScopedSaveConfig,
  collectEndpointDrafts,
  discardEndpointDraft,
  isEndpointDraft,
  reconcileWorkingConfigAfterSave,
} from "../../desktop/src/modules/node-drafts.mjs";

function fixture() {
  return {
    server: { host: "127.0.0.1", port: 8788 },
    clients: {
      codex: {
        endpoints: [
          {
            id: "ep_a",
            name: "A",
            type: "openai-responses",
            base_url: "https://a.example/v1",
            models: ["a"],
          },
          {
            id: "ep_b",
            name: "B",
            type: "openai-responses",
            base_url: "https://b.example/v1",
            models: ["b"],
          },
        ],
      },
    },
  };
}

test("saving one node excludes unrelated endpoint drafts", () => {
  const persisted = fixture();
  const working = structuredClone(persisted);
  working.clients.codex.endpoints[0].name = "A draft";
  working.clients.codex.endpoints[1].name = "B saved";

  const payload = buildNodeSaveConfig(
    persisted,
    working,
    "codex",
    { id: "ep_b", index: 1 },
  );

  assert.equal(payload.clients.codex.endpoints[0].name, "A");
  assert.equal(payload.clients.codex.endpoints[1].name, "B saved");
});

test("back-compatible draft collection survives a server refresh", () => {
  const persisted = fixture();
  const working = structuredClone(persisted);
  working.clients.codex.endpoints[0].name = "A draft";
  working.clients.codex.endpoints.unshift({
    id: "ep_new",
    name: "Copied draft",
    type: "openai-responses",
    base_url: "https://copy.example/v1",
    models: [],
  });

  const drafts = collectEndpointDrafts(persisted, working);
  const refreshed = fixture();
  refreshed.clients.codex.endpoints[1].name = "B refreshed";
  const rebased = applyEndpointDrafts(refreshed, drafts);

  assert.equal(rebased.clients.codex.endpoints[0].id, "ep_new");
  assert.equal(
    rebased.clients.codex.endpoints.find((item) => item.id === "ep_a").name,
    "A draft",
  );
  assert.equal(
    rebased.clients.codex.endpoints.find((item) => item.id === "ep_b").name,
    "B refreshed",
  );
});

test("discard restores persisted nodes and removes unsaved copies", () => {
  const persisted = fixture();
  const working = structuredClone(persisted);
  working.clients.codex.endpoints[0].name = "A draft";

  assert.equal(isEndpointDraft(persisted, working, "codex", {
    id: "ep_a",
    index: 0,
  }), true);

  const restored = discardEndpointDraft(
    persisted,
    working,
    "codex",
    { id: "ep_a", index: 0 },
  );
  assert.equal(restored.clients.codex.endpoints[0].name, "A");

  restored.clients.codex.endpoints.unshift({
    id: "ep_new",
    name: "Copied draft",
    type: "openai-responses",
    base_url: "",
    models: [],
  });
  const withoutCopy = discardEndpointDraft(
    persisted,
    restored,
    "codex",
    { id: "ep_new", index: 0 },
  );
  assert.equal(
    withoutCopy.clients.codex.endpoints.some((item) => item.id === "ep_new"),
    false,
  );
});

test("scoped saves keep unrelated drafts while global saves persist them", () => {
  const persisted = fixture();
  const working = structuredClone(persisted);
  working.clients.codex.endpoints[0].name = "A draft";
  working.clients.codex.endpoints[1].enabled = false;

  const scoped = buildScopedSaveConfig(persisted, working, {
    client: "codex",
    scope: "enabled",
    endpoint: { id: "ep_b", index: 1 },
  });
  assert.equal(scoped.clients.codex.endpoints[0].name, "A");
  assert.equal(scoped.clients.codex.endpoints[1].enabled, false);

  const global = buildScopedSaveConfig(persisted, working, {
    client: "codex",
    scope: "global",
  });
  assert.equal(global.clients.codex.endpoints[0].name, "A draft");
  assert.equal(global.clients.codex.endpoints[1].enabled, false);
});

test("proxy toggles persist only proxy fields from the edited node", () => {
  const persisted = fixture();
  const working = structuredClone(persisted);
  working.clients.codex.endpoints[0].name = "A draft";
  working.clients.codex.endpoints[0].proxy_mode = "disabled";
  delete working.clients.codex.endpoints[0].proxy_url;

  const payload = buildScopedSaveConfig(persisted, working, {
    client: "codex",
    scope: "proxy",
    endpoint: { id: "ep_a", index: 0 },
  });

  assert.equal(payload.clients.codex.endpoints[0].name, "A");
  assert.equal(payload.clients.codex.endpoints[0].proxy_mode, "disabled");
  assert.equal("proxy_url" in payload.clients.codex.endpoints[0], false);
});

test("saving a new default node clears the previous default in its group", () => {
  const persisted = fixture();
  persisted.clients.codex.endpoints[0].is_default = true;
  const working = structuredClone(persisted);
  working.clients.codex.endpoints[0].is_default = false;
  working.clients.codex.endpoints.unshift({
    id: "ep_new",
    name: "New default",
    type: "openai-responses",
    base_url: "https://new.example/v1",
    models: ["new"],
    is_default: true,
  });

  const payload = buildNodeSaveConfig(
    persisted,
    working,
    "codex",
    { id: "ep_new", index: 0 },
  );

  assert.equal(
    payload.clients.codex.endpoints.find((item) => item.id === "ep_new")
      .is_default,
    true,
  );
  assert.equal(
    payload.clients.codex.endpoints.find((item) => item.id === "ep_a")
      .is_default,
    false,
  );
});

test("scoped save keeps unrelated working values and clears saved secrets", () => {
  const persisted = fixture();
  const working = structuredClone(persisted);
  working.clients.codex.future_setting = "draft-value";
  working.clients.codex.endpoints[0].api_key = "sk-new-secret";

  const saved = buildNodeSaveConfig(
    persisted,
    working,
    "codex",
    { id: "ep_a", index: 0 },
  );
  const reconciled = reconcileWorkingConfigAfterSave(
    saved,
    working,
    {
      client: "codex",
      scope: "node",
      endpoint: { id: "ep_a", index: 0 },
    },
  );

  assert.equal(reconciled.clients.codex.future_setting, "draft-value");
  assert.equal(reconciled.clients.codex.endpoints[0].has_api_key, true);
  assert.equal("api_key" in reconciled.clients.codex.endpoints[0], false);
});
