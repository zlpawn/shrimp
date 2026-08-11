import assert from "node:assert/strict";
import test from "node:test";

import {
  createKeyStrategyRegistry,
  selectEndpointCredential,
} from "../../lib/config/key-strategy.mjs";
import {
  getEndpointApiKey,
  getEndpointApiKeyByStrategy,
} from "../../lib/config/gateway-config-store.mjs";

const endpoint = {
  id: "ep_multi",
  api_keys: [{ id: "cred_a" }, { id: "cred_b" }, { id: "cred_c" }],
};
const secrets = {
  api_keys: {
    "ep_multi::cred_a": "sk-a",
    "ep_multi::cred_b": "sk-b",
    "ep_multi::cred_c": "sk-c",
  },
};

test("failover is default and selects by attempt", () => {
  assert.deepEqual(
    selectEndpointCredential(endpoint, secrets, {}, { attempt: 0 }),
    { credentialId: "cred_a", apiKey: "sk-a" },
  );
  assert.deepEqual(
    selectEndpointCredential(endpoint, secrets, {}, { attempt: 1 }),
    { credentialId: "cred_b", apiKey: "sk-b" },
  );
});

test("round-robin advances per endpoint and resets with an injected store", () => {
  const registry = createKeyStrategyRegistry({
    counterStore: new Map(),
    random: () => 0,
  });
  const roundRobin = { ...endpoint, key_strategy: "round-robin" };
  assert.equal(
    selectEndpointCredential(roundRobin, secrets, {}, {}, registry).credentialId,
    "cred_a",
  );
  assert.equal(
    selectEndpointCredential(roundRobin, secrets, {}, {}, registry).credentialId,
    "cred_b",
  );
  assert.equal(
    selectEndpointCredential(roundRobin, secrets, {}, {}, registry).credentialId,
    "cred_c",
  );
});

test("random uses injected RNG", () => {
  const registry = createKeyStrategyRegistry({
    counterStore: new Map(),
    random: () => 0.6,
  });
  const selected = selectEndpointCredential(
    { ...endpoint, key_strategy: "random" },
    secrets,
    {},
    {},
    registry,
  );
  assert.equal(selected.credentialId, "cred_b");
});

test("selection skips missing credentials and returns an empty result when none resolve", () => {
  assert.deepEqual(
    selectEndpointCredential(endpoint, { api_keys: {} }, {}, {}),
    { credentialId: null, apiKey: "" },
  );
});

test("new strategies can be registered without changing selection dispatch", () => {
  const registry = createKeyStrategyRegistry({
    counterStore: new Map(),
    random: () => 0,
  });
  registry.register("last", ({ credentials }) => credentials.at(-1));
  const selected = registry.select("last", {
    endpoint,
    credentials: [
      { credentialId: "cred_a", apiKey: "sk-a" },
      { credentialId: "cred_b", apiKey: "sk-b" },
    ],
    context: {},
  });
  assert.equal(selected.credentialId, "cred_b");
});

test("strategy wrapper keeps the legacy single-key lookup result", () => {
  const singleEndpoint = { id: "ep_single" };
  const singleSecrets = { api_keys: { ep_single: "sk-single" } };
  assert.equal(
    getEndpointApiKey(singleEndpoint, singleSecrets, {}, []),
    "sk-single",
  );
  assert.deepEqual(
    getEndpointApiKeyByStrategy(singleEndpoint, singleSecrets, {}, [], {}),
    { credentialId: null, apiKey: "sk-single" },
  );
});
