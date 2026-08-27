import test from "node:test";
import assert from "node:assert/strict";
import {
  createNetworkBuffer,
  createNetworkSession,
  getNetworkEntries,
  upsertNetworkEntry,
  filterNetworkEntries,
  toNetworkSummary,
} from "../../../extensions/leo-cookie-txt-locally/network-capture.mjs";

test("network session upsert and grep", () => {
  const buffer = createNetworkBuffer();
  upsertNetworkEntry(buffer, {
    requestId: "1",
    method: "POST",
    url: "https://example.com/api/deploy",
    status: 200,
    mimeType: "application/json",
  });
  upsertNetworkEntry(buffer, {
    requestId: "1",
    status: 201,
  });
  const entries = getNetworkEntries(buffer);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 201);
  const filtered = filterNetworkEntries(entries, "deploy");
  assert.equal(filtered.length, 1);
  assert.equal(toNetworkSummary(filtered[0]).method, "POST");
});

test("network buffer updates by request ID and evicts the oldest request at its limit", () => {
  const buffer = createNetworkBuffer(2);
  upsertNetworkEntry(buffer, { requestId: "one", url: "https://example.com/one", status: 100 });
  upsertNetworkEntry(buffer, { requestId: "two", url: "https://example.com/two" });
  upsertNetworkEntry(buffer, { requestId: "one", status: 200 });

  assert.deepEqual(getNetworkEntries(buffer).map((entry) => [entry.requestId, entry.status]), [
    ["one", 200],
    ["two", undefined],
  ]);

  upsertNetworkEntry(buffer, { requestId: "three", url: "https://example.com/three" });
  assert.deepEqual(getNetworkEntries(buffer).map((entry) => entry.requestId), ["two", "three"]);
});

test("network session durable summary does not contain full entries", () => {
  const session = createNetworkSession({ tabId: 7, startedAt: 1, attachedByLantern: true });
  assert.deepEqual(session, {
    tabId: 7,
    attachedByLantern: true,
    startedAt: 1,
    stoppedAt: null,
    entryCount: 0,
    recovered: false,
    entriesLost: false,
  });
});

test("default network buffer caps captured requests at one thousand", () => {
  const buffer = createNetworkBuffer();
  for (let index = 0; index < 1_005; index += 1) {
    upsertNetworkEntry(buffer, { requestId: String(index), url: `https://example.com/${index}` });
  }
  const entries = getNetworkEntries(buffer);
  assert.equal(entries.length, 1_000);
  assert.equal(entries[0].requestId, "5");
  assert.equal(entries.at(-1).requestId, "1004");
});
