import test from "node:test";
import assert from "node:assert/strict";
import {
  createNetworkSession,
  upsertNetworkEntry,
  filterNetworkEntries,
  toNetworkSummary,
} from "../../../extensions/leo-cookie-txt-locally/network-capture.mjs";

test("network session upsert and grep", () => {
  let session = createNetworkSession({ tabId: 7, startedAt: 1 });
  session = upsertNetworkEntry(session, {
    requestId: "1",
    method: "POST",
    url: "https://example.com/api/deploy",
    status: 200,
    mimeType: "application/json",
  });
  session = upsertNetworkEntry(session, {
    requestId: "1",
    status: 201,
  });
  assert.equal(session.entries.length, 1);
  assert.equal(session.entries[0].status, 201);
  const filtered = filterNetworkEntries(session.entries, "deploy");
  assert.equal(filtered.length, 1);
  assert.equal(toNetworkSummary(filtered[0]).method, "POST");
});
