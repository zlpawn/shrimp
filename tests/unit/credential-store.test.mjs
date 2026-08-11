import assert from "node:assert/strict";
import test from "node:test";

import {
  createCredentialId,
  credentialSecretKey,
  listEndpointCredentials,
  hasStoredEndpointCredential,
  maskApiKey,
  parseCredentialSecretKey,
  resolveStoredSecret,
} from "../../lib/config/credential-store.mjs";

test("credential ids are prefixed UUIDs and unique", () => {
  const ids = new Set(Array.from({ length: 100 }, () => createCredentialId()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^cred_[0-9a-f-]{36}$/);
});

test("credential secret keys round-trip", () => {
  const key = credentialSecretKey("ep_abc", "cred_001");
  assert.equal(key, "ep_abc::cred_001");
  assert.deepEqual(parseCredentialSecretKey(key), {
    endpointId: "ep_abc",
    credentialId: "cred_001",
  });
  assert.equal(parseCredentialSecretKey("ep_abc"), null);
});

test("stored env references resolve without exposing the env name as a key", () => {
  assert.equal(resolveStoredSecret("env:ARK_KEY", { ARK_KEY: "ark-live" }), "ark-live");
  assert.equal(resolveStoredSecret("sk-literal", {}), "sk-literal");
});

test("credential listing follows endpoint order and skips empty values", () => {
  const endpoint = {
    id: "ep_abc",
    api_keys: [{ id: "cred_a" }, { id: "cred_b" }, { id: "cred_c" }],
  };
  const secrets = {
    api_keys: {
      "ep_abc::cred_a": "sk-a",
      "ep_abc::cred_b": "",
      "ep_abc::cred_c": "env:C_KEY",
    },
  };
  assert.deepEqual(listEndpointCredentials(endpoint, secrets, { C_KEY: "sk-c" }), [
    { credentialId: "cred_a", apiKey: "sk-a" },
    { credentialId: "cred_c", apiKey: "sk-c" },
  ]);
});

test("partial migration maps the legacy endpoint secret to the first credential", () => {
  const endpoint = {
    id: "ep_abc",
    api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
  };
  const secrets = { api_keys: { ep_abc: "sk-legacy" } };
  assert.deepEqual(listEndpointCredentials(endpoint, secrets, {}), [
    { credentialId: "cred_a", apiKey: "sk-legacy" },
  ]);
});

test("stored credential presence counts env references without resolving them", () => {
  const endpoint = { id: "ep_env", api_keys: [{ id: "cred_env" }] };
  const secrets = { api_keys: { "ep_env::cred_env": "env:MISSING_KEY" } };
  assert.equal(hasStoredEndpointCredential(endpoint, secrets), true);
});

test("masking shows four leading and three trailing characters", () => {
  assert.equal(maskApiKey("ark-abcdefXYZ"), "ark-...XYZ");
  assert.equal(maskApiKey("short"), "****");
});
