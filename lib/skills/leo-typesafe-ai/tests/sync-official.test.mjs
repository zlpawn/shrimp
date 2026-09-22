import test from "node:test";
import assert from "node:assert/strict";

import {
  parseSyncArgs,
  portableSourceLabel,
  sha256,
  summarizeDiff,
} from "../scripts/sync-official.mjs";

test("sync modes are explicit and check is the safe default", () => {
  assert.equal(parseSyncArgs([]).mode, "check");
  assert.equal(parseSyncArgs(["--diff"]).mode, "diff");
  assert.equal(parseSyncArgs(["--apply"]).mode, "apply");
});

test("hashing and compact diff detect official changes", () => {
  assert.notEqual(sha256("old"), sha256("new"));
  const diff = summarizeDiff("one\ntwo\nthree", "one\nchanged\nthree");
  assert.equal(diff.first_changed_line, 2);
  assert.deepEqual(diff.old_excerpt, ["two"]);
  assert.deepEqual(diff.new_excerpt, ["changed"]);
});

test("official source metadata is portable inside the home directory", () => {
  assert.equal(
    portableSourceLabel("C:\\Users\\leo\\.agents\\skills\\typesafe-ai\\SKILL.md", "C:\\Users\\leo"),
    "~/.agents/skills/typesafe-ai/SKILL.md",
  );
});
