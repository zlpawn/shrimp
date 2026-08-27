import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCliShimManager } from "../../lib/cli-core/shim-manager.mjs";

function makeFsStub() {
  const files = new Map();
  return {
    files,
    existsSync: (file) => files.has(path.resolve(file)),
    mkdirSync: (dir, options) => {
      files.set(path.resolve(dir), { type: "dir", mode: options?.mode });
    },
    readFileSync: (file, encoding) => {
      const entry = files.get(path.resolve(file));
      if (!entry) throw new Error("ENOENT: " + file);
      return entry.content;
    },
    writeFileSync: (file, content, options) => {
      files.set(path.resolve(file), { type: "file", content, mode: options?.mode });
    },
    chmodSync: (file, mode) => {
      const entry = files.get(path.resolve(file));
      if (!entry) throw new Error("ENOENT: " + file);
      entry.mode = mode;
    },
    unlinkSync: (file) => {
      if (!files.delete(path.resolve(file))) throw new Error("ENOENT: " + file);
    },
  };
}

function makeManager({ platform = process.platform, shell = "/bin/zsh" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cli-shim-"));
  const home = path.join(root, "home");
  const data = path.join(root, "data");
  const source = path.join(root, "agent-transfer");
  const fs = makeFsStub();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const manager = createCliShimManager({
    homeDir: home,
    dataDir: data,
    sourceRoot: source,
    platform,
    shell,
    env: { PATH: "/usr/bin:/bin" },
    fsImpl: fs,
    now: () => "2026-08-27T00:00:00.000Z",
  });
  return { manager, root, home, data, source, fs };
}

test("install creates a portable shell shim and records ownership", () => {
  const { manager, home, data, fs } = makeManager();
  const result = manager.install({
    name: "leo-lantern",
    lang: "node",
    command: "node",
    args: ["./clis/leo-lantern/index.mjs"],
  });

  const shimPath = path.join(home, ".shrimp", "bin", "leo-lantern");
  assert.equal(result.name, "leo-lantern");
  assert.equal(result.shimPath, shimPath);
  const shim = fs.readFileSync(shimPath, "utf8");
  assert.match(shim, /# >>> shrimp managed cli shim >>>/);
  assert.match(shim, /exec node ".+clis.leo-lantern.index\.mjs" "\$@"/);

  const records = JSON.parse(fs.readFileSync(path.join(data, "cli-shims.json"), "utf8"));
  assert.equal(records.version, 1);
  assert.equal(records.shims["leo-lantern"].name, "leo-lantern");
  assert.equal(records.shims["leo-lantern"].installedAt, "2026-08-27T00:00:00.000Z");
});

test("install resolves relative source paths and supports uv launchers", () => {
  const { manager, home, fs } = makeManager();
  manager.install({
    name: "demo-py",
    lang: "python",
    command: "uv",
    args: ["run", "--directory", "./clis/demo-py", "cli.py"],
  });
  const shim = fs.readFileSync(path.join(home, ".shrimp", "bin", "demo-py"), "utf8");
  assert.match(shim, /SOURCE_ROOT='.+'/);
  assert.match(shim, /exec uv "run" "--directory" ".+clis.demo-py" "cli\.py" "\$@"/);
});

test("install refuses to overwrite an unregistered command", () => {
  const { manager, home, fs } = makeManager();
  const shimPath = path.join(home, ".shrimp", "bin", "existing-cli");
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(shimPath, "#!/bin/sh\nkeep me\n");

  assert.throws(
    () => manager.install({ name: "existing-cli", lang: "node", command: "node", args: ["./clis/x/index.mjs"] }),
    /already exists and is not managed by Shrimp/,
  );
  assert.equal(fs.readFileSync(shimPath, "utf8"), "#!/bin/sh\nkeep me\n");
});

test("install rejects unsafe command names", () => {
  const { manager } = makeManager();
  for (const name of ["../escape", "nested/name", "bad.exe"]) {
    assert.throws(() => manager.install({ name, command: "node", args: [] }), /CLI name is invalid/);
  }
});

test("install can repair a registered shim and uninstall removes it", () => {
  const { manager, home } = makeManager();
  manager.install({ name: "repair-me", lang: "node", command: "node", args: ["./clis/r/index.mjs"] });
  const repaired = manager.install({
    name: "repair-me",
    lang: "node",
    command: "node",
    args: ["./clis/repaired/index.mjs"],
  });
  assert.equal(repaired.repaired, true);

  manager.uninstall("repair-me");
  assert.deepEqual(manager.list().shims, []);
  assert.equal(manager.isInstalled("repair-me"), false);
});

test("uninstall protects files not owned by Shrimp", () => {
  const { manager, home, fs } = makeManager();
  const shimPath = path.join(home, ".shrimp", "bin", "unknown-cli");
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(shimPath, "#!/bin/sh\nkeep me\n");
  assert.throws(() => manager.uninstall("unknown-cli"), /not managed by Shrimp/);
  assert.equal(fs.readFileSync(shimPath, "utf8"), "#!/bin/sh\nkeep me\n");
});

test("ensurePath writes the Git Bash rc on Windows and zshrc on macOS", () => {
  const windows = makeManager({ platform: "win32", shell: "C:\\Program Files\\Git\\bin\\bash.exe" });
  const winPath = windows.manager.ensurePath();
  assert.equal(winPath.shell, "git-bash");
  const winRc = windows.fs.readFileSync(path.join(windows.home, ".bashrc"), "utf8");
  assert.match(winRc, /# >>> shrimp bin >>>/);
  assert.match(winRc, /export PATH="\$HOME\/\.shrimp\/bin:\$PATH"/);

  const mac = makeManager({ platform: "darwin", shell: "/bin/zsh" });
  const macPath = mac.manager.ensurePath();
  assert.equal(macPath.shell, "zsh");
  const macRc = mac.fs.readFileSync(path.join(mac.home, ".zshrc"), "utf8");
  assert.match(macRc, /# >>> shrimp bin >>>/);
});

test("status reports installed shims and configured rc", () => {
  const { manager } = makeManager({ platform: "darwin", shell: "/bin/zsh" });
  manager.install({ name: "status-cli", lang: "node", command: "node", args: ["./clis/s/index.mjs"] });
  manager.ensurePath();
  const status = manager.status();
  assert.equal(status.binDir.endsWith(path.join(".shrimp", "bin")), true);
  assert.equal(status.pathConfigured, true);
  assert.equal(status.shims[0].name, "status-cli");
});
