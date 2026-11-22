import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import { execFileSync } from "node:child_process";

import {
  parseScutilProxyOutput,
  parseWindowsRegProxyOutput,
  resolveUserLocalProxy,
} from "../../lib/ofm/proxy.mjs";
import {
  DEFAULT_BIN_OFM_DIR,
  extractTarGzToMap,
  getInstalledOfmInfo,
  selectStandaloneRuntimeFiles,
  writeStandaloneFilesToDirectory,
} from "../../lib/ofm/updater.mjs";
import {
  DEFAULT_OFM_DATA_DIR,
  readOfmForwardKey,
  resolveOfmCli,
} from "../../lib/ofm/supervisor.mjs";
import { ofmStrategy } from "../../lib/models/strategies/ofm.mjs";

function makeTarEntry(name, contentBuffer) {
  const header = Buffer.alloc(512, 0);
  Buffer.from(name, "utf8").copy(header, 0, 0, 100);
  Buffer.from("0000644\0", "ascii").copy(header, 100);
  Buffer.from("0000000\0", "ascii").copy(header, 108);
  Buffer.from("0000000\0", "ascii").copy(header, 116);
  Buffer.from(contentBuffer.length.toString(8).padStart(11, "0") + "\0", "ascii").copy(header, 124);
  Buffer.from("00000000000\0", "ascii").copy(header, 136);
  Buffer.from("        ", "ascii").copy(header, 148);
  header[156] = "0".charCodeAt(0);
  Buffer.from("ustar\0", "ascii").copy(header, 257);
  Buffer.from("00", "ascii").copy(header, 263);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ", "ascii").copy(header, 148);

  const rem = contentBuffer.length % 512;
  const pad = rem === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - rem, 0);
  return Buffer.concat([header, contentBuffer, pad]);
}

test("proxy parser handles macOS scutil and Windows Registry formats", () => {
  const scutilOut = `
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
}`;
  assert.equal(parseScutilProxyOutput(scutilOut), "http://127.0.0.1:7897");
  assert.equal(
    parseScutilProxyOutput("SOCKSEnable : 1\nSOCKSProxy : 127.0.0.1\nSOCKSPort : 1080"),
    "socks5://127.0.0.1:1080",
  );

  const winReg = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7891
`;
  assert.equal(parseWindowsRegProxyOutput(winReg), "http://127.0.0.1:7891");
  assert.equal(parseWindowsRegProxyOutput("ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ 127.0.0.1:7890"), "");
});

test("resolveUserLocalProxy prefers env vars, then system proxy, then direct", () => {
  assert.deepEqual(
    resolveUserLocalProxy({
      env: { HTTPS_PROXY: "http://127.0.0.1:8888" },
      systemProxyDetector: () => "http://127.0.0.1:9999",
    }),
    { url: "http://127.0.0.1:8888", source: "env" },
  );
  assert.deepEqual(
    resolveUserLocalProxy({
      env: {},
      systemProxyDetector: () => "127.0.0.1:7897",
    }),
    { url: "http://127.0.0.1:7897", source: "system" },
  );
  assert.deepEqual(
    resolveUserLocalProxy({
      env: {},
      systemProxyDetector: () => "",
    }),
    { url: "", source: "direct" },
  );
});

test("bin/ofm status is reported and bundled CLI prints usage when present", () => {
  const info = getInstalledOfmInfo(DEFAULT_BIN_OFM_DIR);
  const resolved = resolveOfmCli();
  assert.equal(resolved.installed, info.installed);
  if (info.installed) {
    assert.ok(info.version);
    const out = execFileSync(process.execPath, [info.cliPath, "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.match(out, /--port/);
    assert.match(out, /--data-dir/);
  }
});

test("DEFAULT_OFM_DATA_DIR is under ~/.shrimp/providers/ofm and reads forwardKey", () => {
  assert.equal(
    DEFAULT_OFM_DATA_DIR,
    path.join(os.homedir(), ".shrimp", "providers", "ofm"),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ofm-data-"));
  try {
    fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ forwardKey: "ofm-test-key" }));
    assert.equal(readOfmForwardKey(tmp), "ofm-test-key");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("tar.gz extractor and atomic writer stage and swap OFM runtime", () => {
  const tarBuf = Buffer.concat([
    makeTarEntry("repo-main/packages/standalone/cli.mjs", Buffer.from("console.log('cli')\n")),
    makeTarEntry("repo-main/packages/standalone/service.mjs", Buffer.from("export function startStandalone(){}\n")),
    makeTarEntry("repo-main/packages/standalone/package.json", Buffer.from('{"name":"ofm","version":"2.9.9"}\n')),
    makeTarEntry("repo-main/packages/standalone/web/assets.json", Buffer.from('["app.js"]\n')),
    makeTarEntry("repo-main/packages/standalone/web/app.js", Buffer.from("console.log('ui')\n")),
    makeTarEntry("repo-main/src/core.js", Buffer.from("export const x = 1\n")),
    makeTarEntry("repo-main/README.md", Buffer.from("ignored doc\n")),
    Buffer.alloc(1024, 0),
  ]);
  const gz = zlib.gzipSync(tarBuf);
  const extracted = extractTarGzToMap(gz);
  assert.equal(extracted.has("README.md"), true);

  const selected = selectStandaloneRuntimeFiles(extracted);
  assert.equal(selected.has("README.md"), false);
  assert.equal(selected.has("packages/standalone/cli.mjs"), true);
  assert.equal(selected.has("packages/standalone/web/app.js"), true);
  assert.equal(selected.has("src/core.js"), true);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ofm-upd-"));
  try {
    const targetDir = path.join(tmp, "bin", "ofm");
    const sync = writeStandaloneFilesToDirectory({
      selectedFiles: selected,
      targetDir,
      meta: { commitSha: "abcdef1234567890", coreVersion: "2.9.9" },
    });
    assert.equal(sync.version, "2.9.9");
    const installed = getInstalledOfmInfo(targetDir);
    assert.equal(installed.installed, true);
    assert.equal(installed.version, "2.9.9");
    assert.equal(installed.commitSha, "abcdef1234567890");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8")).type,
      "module",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ofmStrategy matches OFM endpoints and discovers models", async () => {
  assert.equal(ofmStrategy.supports({ type: "ofm", base_url: "http://127.0.0.1:18900" }), true);
  assert.equal(ofmStrategy.supports({ type: "anthropic", base_url: "https://api.anthropic.com" }), false);

  let seenUrl = "";
  const result = await ofmStrategy.discover(
    { type: "ofm", base_url: "http://127.0.0.1:18900" },
    {
      ensureReady: async () => ({ ok: true }),
      apiKey: "ofm-key",
      fetchImpl: async (url) => {
        seenUrl = url;
        return new Response(
          JSON.stringify({
            data: [
              { id: "zcode/GLM-5.3" },
              { id: "qodercn/DeepSeek-V4-Pro" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );
  assert.equal(seenUrl, "http://127.0.0.1:18900/v1/models");
  assert.equal(result.source, "ofm");
  assert.deepEqual(result.models.map((m) => m.id), ["zcode/GLM-5.3", "qodercn/DeepSeek-V4-Pro"]);
});
