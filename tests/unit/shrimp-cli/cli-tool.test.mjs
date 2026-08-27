import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRegistry } from "../../../lib/shrimp-cli/index.mjs";

test("shrimp cli commands install, list, and remove managed shims", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shrimp-cli-shim-"));
  const data = path.join(root, "data");
  const source = path.join(root, "source");
  const home = path.join(root, "home");
  mkdirSync(data, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(source, "clis", "demo-node-cli"), { recursive: true });
  writeFileSync(path.join(source, "clis", "demo-node-cli", "index.mjs"), "process.exit(0)\n");
  const env = { USERPROFILE: home, HOME: home, SHELL: "/bin/zsh" };
  const registry = buildRegistry();

  try {
    const install = await registry.dispatch(["cli", "install", "demo-node-cli"], {
      packageRoot: source,
      dataDir: data,
      cwd: source,
      env,
      platform: "darwin",
    });
    assert.equal(install.ok, true);
    assert.equal(install.envelope.data.shim.name, "demo-node-cli");
    assert.equal(install.envelope.data.status.shell, "zsh");

    const list = await registry.dispatch(["cli", "list"], {
      packageRoot: source,
      dataDir: data,
      cwd: source,
      env,
      platform: "darwin",
    });
    assert.deepEqual(list.envelope.data.shims.map((shim) => shim.name), ["demo-node-cli"]);

    const uninstall = await registry.dispatch(["cli", "uninstall", "demo-node-cli"], {
      packageRoot: source,
      dataDir: data,
      cwd: source,
      env,
      platform: "darwin",
    });
    assert.equal(uninstall.envelope.data.result.removed, true);
    assert.deepEqual(uninstall.envelope.data.status.shims, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
