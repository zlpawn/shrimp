import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getPlatformInfo,
  getPaths,
  getRuntimeBaseDir,
  getProviderPaths,
  setRuntimeBaseDir,
} from "../scripts/core/system.mjs";
import { isPortInUse } from "../scripts/core/port.mjs";
import { renderToml, setServer, addProxy, removeProxy, getPublicConfig } from "../scripts/providers/frp/config.mjs";
import { compareVersions } from "../scripts/providers/frp/install.mjs";
import { runProbe } from "../scripts/probe.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routerScript = path.resolve(__dirname, "../scripts/router.mjs");

test("system core detection returns normalized platform and paths", () => {
  const info = getPlatformInfo();
  assert.ok(["darwin", "linux", "windows"].includes(info.platform));
  assert.ok(["arm64", "amd64"].includes(info.arch));

  const paths = getPaths();
  assert.ok(paths.localBinDir.includes(".local"));
  assert.ok(paths.runtimeDir.includes("leo-nat-traversal-router"));
});

test("multi-tool directory isolation and configurability works", () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "leo-nat-test-"));

  try {
    // 1. Provider namespace isolation
    const frpPaths = getProviderPaths("frp", tmpBase);
    const cfPaths = getProviderPaths("cloudflare", tmpBase);

    assert.ok(frpPaths.configDir.includes(path.join("providers", "frp", "config")));
    assert.ok(cfPaths.configDir.includes(path.join("providers", "cloudflare", "config")));
    assert.notEqual(frpPaths.configDir, cfPaths.configDir);

    // 2. Environment variable priority
    process.env.LEO_NAT_DATA_DIR = path.join(tmpBase, "env-override");
    const envDir = getRuntimeBaseDir();
    assert.equal(envDir, path.join(tmpBase, "env-override"));
    delete process.env.LEO_NAT_DATA_DIR;

    // 3. Explicit override parameter
    const explicitDir = getRuntimeBaseDir(path.join(tmpBase, "explicit"));
    assert.equal(explicitDir, path.join(tmpBase, "explicit"));
  } finally {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  }
});

test("port detection accurately identifies open and closed ports", async () => {
  const freePort = 59123;
  const inUseBefore = await isPortInUse(freePort);
  assert.equal(inUseBefore, false);

  const server = net.createServer();
  await new Promise((resolve) => server.listen(freePort, "127.0.0.1", resolve));

  const inUseDuring = await isPortInUse(freePort);
  assert.equal(inUseDuring, true);

  await new Promise((resolve) => server.close(resolve));
  const inUseAfter = await isPortInUse(freePort);
  assert.equal(inUseAfter, false);
});

test("frp config renderer generates valid toml and masks token", () => {
  const dummyCfg = {
    serverAddr: "1.2.3.4",
    serverPort: 7000,
    logLevel: "debug",
    proxies: [
      {
        name: "test-web",
        type: "tcp",
        localIP: "127.0.0.1",
        localPort: 8080,
        remotePort: 18080,
      },
    ],
  };

  const toml = renderToml(dummyCfg, { token: "super_secret_token" });
  assert.match(toml, /serverAddr = "1.2.3.4"/);
  assert.match(toml, /serverPort = 7000/);
  assert.match(toml, /auth\.token = "super_secret_token"/);
  assert.match(toml, /\[\[proxies\]\]/);
  assert.match(toml, /name = "test-web"/);
  assert.match(toml, /remotePort = 18080/);
});

test("frp config state operations work properly in isolated dataDir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-frp-test-"));

  try {
    setServer({ serverAddr: "114.114.114.114", serverPort: 7000, token: "testtoken123", dataDir: tmpDir });
    addProxy({ name: "unit-test-proxy", type: "tcp", localPort: 3000, remotePort: 13000, dataDir: tmpDir });

    const pub = getPublicConfig(tmpDir);
    assert.equal(pub.serverAddr, "114.114.114.114");
    assert.equal(pub.hasToken, true);
    assert.equal(pub.tokenMasked.includes("****"), true);
    assert.ok(pub.proxies.some((p) => p.name === "unit-test-proxy"));

    const rem = removeProxy("unit-test-proxy", tmpDir);
    assert.equal(rem.success, true);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("runProbe outputs structured status report with dataDirSource", () => {
  const report = runProbe();
  assert.ok(report.timestamp);
  assert.ok(report.system.platform);
  assert.ok(report.system.dataDirSource);
  assert.ok(report.providers.frp);
  assert.ok(report.providers.cloudflare);
});

test("router CLI executes commands with --data-dir flag without crash", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-cli-test-"));

  try {
    const probeOutput = execSync(`node "${routerScript}" probe --data-dir="${tmpDir}"`, { encoding: "utf-8" });
    const parsed = JSON.parse(probeOutput);
    assert.equal(parsed.system.dataDirSource, "cli-argument");
    assert.equal(parsed.system.runtimeDir, tmpDir);

    const getDataDirOut = execSync(`node "${routerScript}" get-data-dir --data-dir="${tmpDir}"`, { encoding: "utf-8" });
    const parsedDataDir = JSON.parse(getDataDirOut);
    assert.equal(parsedDataDir.dataDir, tmpDir);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test("compareVersions accurately handles semantic versions", () => {
  assert.equal(compareVersions("0.72.0", "0.71.0"), 1);
  assert.equal(compareVersions("0.71.0", "0.72.0"), -1);
  assert.equal(compareVersions("0.72.0", "0.72.0"), 0);
  assert.equal(compareVersions("v0.72.1", "0.72.0"), 1);
});
