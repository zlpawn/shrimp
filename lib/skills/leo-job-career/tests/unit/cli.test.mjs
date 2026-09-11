import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "../../scripts/lib/config.mjs";
import { formatSuccess, formatError, parseCliArgs, executeDoctor } from "../../scripts/lib/cli.mjs";

test("resolveRuntimePaths resolves default and custom base paths", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-test-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  assert.equal(paths.root, tmpBase);
  assert.equal(paths.auth, path.join(tmpBase, "auth"));
  assert.equal(paths.config, path.join(tmpBase, "config"));
  assert.equal(paths.profile, path.join(tmpBase, "profile"));
  assert.equal(paths.data, path.join(tmpBase, "data"));
  assert.equal(paths.runs, path.join(tmpBase, "runs"));
  assert.equal(paths.reports, path.join(tmpBase, "reports"));
});

test("ensureRuntimeDirectories creates directories with 0700 permissions", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-ensure-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  ensureRuntimeDirectories(paths);

  assert.ok(fs.existsSync(paths.root));
  assert.ok(fs.existsSync(paths.auth));
  assert.ok(fs.existsSync(paths.config));
  assert.ok(fs.existsSync(paths.profile));
  assert.ok(fs.existsSync(paths.data));
  assert.ok(fs.existsSync(paths.runs));
  assert.ok(fs.existsSync(paths.reports));

  if (process.platform !== "win32") {
    const statAuth = fs.statSync(paths.auth);
    // mode & 0777 should be 0700 (448 decimal)
    assert.equal(statAuth.mode & 0o777, 0o700);
  }

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("formatSuccess produces standard envelope", () => {
  const res = formatSuccess("test.command", { total: 42 }, { warnings: ["note"], next_actions: ["proceed"] });
  assert.equal(res.ok, true);
  assert.equal(res.command, "test.command");
  assert.deepEqual(res.data, { total: 42 });
  assert.deepEqual(res.warnings, ["note"]);
  assert.deepEqual(res.next_actions, ["proceed"]);
});

test("formatError produces standard envelope", () => {
  const res = formatError("AUTH_REQUIRED", "No cookie header", { checkpoint_saved: true, next_actions: ["copy-header"] });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "AUTH_REQUIRED");
  assert.equal(res.error.message, "No cookie header");
  assert.equal(res.checkpoint_saved, true);
  assert.deepEqual(res.next_actions, ["copy-header"]);
});

test("parseCliArgs extracts command, subcommand and flags", () => {
  const argv = ["node", "leo_job_career.mjs", "market", "init", "--city", "北京", "--target", "100", "--dry-run"];
  const parsed = parseCliArgs(argv.slice(2));
  assert.equal(parsed.command, "market");
  assert.equal(parsed.subcommand, "init");
  assert.equal(parsed.flags.city, "北京");
  assert.equal(parsed.flags.target, "100");
  assert.equal(parsed.flags["dry-run"], true);
});

test("executeDoctor returns environment diagnosis", () => {
  const tmpBase = path.join(os.tmpdir(), "leo-job-career-doc-" + Date.now());
  const paths = resolveRuntimePaths(tmpBase);
  const result = executeDoctor({ paths });
  assert.equal(result.ok, true);
  assert.equal(result.command, "doctor");
  assert.ok(result.data.node_version);
  assert.ok(result.data.platform);
  assert.equal(result.data.runtime_root, tmpBase);
  fs.rmSync(tmpBase, { recursive: true, force: true });
});
