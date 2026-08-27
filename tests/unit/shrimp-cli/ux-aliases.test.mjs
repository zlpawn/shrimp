import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistry } from "../../../lib/shrimp-cli/index.mjs";
import { parseGlobalFlags } from "../../../lib/shrimp-cli/parse-args.mjs";

test("short aliases resolve to canonical commands", () => {
  const reg = buildRegistry();
  assert.equal(reg.resolveCommand(["ep", "ls"])?.name, "endpoint.list");
  assert.equal(reg.resolveCommand(["st"])?.name, "status");
  assert.equal(reg.resolveCommand(["key", "set"])?.name, "secret.set");
  assert.equal(reg.resolveCommand(["c", "copy"])?.name, "client.copy");
  assert.equal(reg.resolveCommand(["c", "rename"])?.name, "client.rename");
  assert.equal(reg.resolveCommand(["tools", "ls"])?.name, "cli-tool.list");
  assert.equal(reg.resolveCommand(["oauth", "status"])?.name, "upstream.google-oauth.status");
});

test("global flags can appear after command tokens", () => {
  const parsed = parseGlobalFlags(["endpoint", "list", "--format", "pretty", "--data-dir", "D:/tmp"]);
  assert.deepEqual(parsed.rest, ["endpoint", "list"]);
  assert.equal(parsed.flags.format, "pretty");
  assert.equal(parsed.flags.dataDir, "D:/tmp");
});

test("help data is grouped", () => {
  const reg = buildRegistry();
  const help = reg.helpData();
  assert.ok(help.groups.some((g) => g.name === "endpoint"));
  assert.ok(help.tips.length >= 3);
});