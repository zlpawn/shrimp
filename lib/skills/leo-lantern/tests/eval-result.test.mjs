import test from "node:test";
import assert from "node:assert/strict";
import { createCommandQueue } from "../../../../extensions/leo-cookie-txt-locally/command-queue.mjs";
import { evalOutcome } from "../../../../extensions/leo-cookie-txt-locally/page-drive.mjs";

test("an eval value survives the command queue", async () => {
  const reports = [];
  const queue = createCommandQueue({
    execute: () => evalOutcome(2, true),
    report: (source, id, envelope) => reports.push(envelope),
  });
  await queue.submit("bridge", { id: "cmd", type: "page.eval" });
  assert.deepEqual(reports, [{ ok: true, result: { evalResult: 2, hasResult: true, resultType: "number" } }]);
});

test("a script that returns nothing reports null", () => {
  assert.deepEqual(evalOutcome(undefined, true), { evalResult: null, hasResult: true, resultType: "null" });
});
