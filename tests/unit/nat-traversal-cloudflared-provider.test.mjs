import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCloudflaredProvider } from "../../lib/nat-traversal/providers/cloudflared.mjs";
import { createProviderRegistry } from "../../lib/nat-traversal/providers/registry.mjs";
import { LINK_STATUS } from "../../lib/nat-traversal/domain/status.mjs";

test("cloudflared provider metadata and capabilities", () => {
  const provider = createCloudflaredProvider({
    paths: { cloudflaredPidPath: "/tmp/cf.pid", cloudflaredLogPath: "/tmp/cf.log" },
  });
  assert.equal(provider.id, "cloudflared");
  assert.deepEqual(provider.capabilities(), [
    "tunnel",
    "process-control",
    "quick-tunnel",
    "token-tunnel",
  ]);
});

test("cloudflared provider is auto-registered in provider registry", () => {
  const registry = createProviderRegistry({
    paths: {
      pidPath: "/tmp/frpc.pid",
      logPath: "/tmp/frpc.log",
      cloudflaredPidPath: "/tmp/cf.pid",
      cloudflaredLogPath: "/tmp/cf.log",
    },
  });
  const cf = registry.get("cloudflared");
  assert.equal(cf.id, "cloudflared");
  const list = registry.list();
  assert.ok(list.some((p) => p.id === "frpc"));
  assert.ok(list.some((p) => p.id === "cloudflared"));
});

test("cloudflared provider lifecycle forwarding to supervisor", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-prov-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  let startedWith = null;
  let stopped = false;
  let statusCallCount = 0;

  const mockSupervisor = {
    start: async (opts) => {
      startedWith = opts;
      return { status: "running", pid: 1234, ...opts };
    },
    stop: async () => {
      stopped = true;
      return { status: "stopped", pid: 0 };
    },
    getStatus: () => {
      statusCallCount++;
      return {
        status: startedWith && !stopped ? "running" : "stopped",
        pid: startedWith && !stopped ? 1234 : 0,
        mode: startedWith?.mode || "quick",
        quickUrl: "https://test.trycloudflare.com",
      };
    },
  };

  const provider = createCloudflaredProvider({
    paths: {
      cloudflaredPidPath: path.join(tmpDir, "cf.pid"),
      cloudflaredLogPath: path.join(tmpDir, "cf.log"),
    },
    supervisorFactory: () => mockSupervisor,
  });

  const cfg = {
    activeProvider: "cloudflared",
    cloudflared: {
      mode: "quick",
      localUrl: "http://127.0.0.1:8787",
      publicUrl: "",
    },
  };

  await provider.applyConfig(cfg, { token: "secret-token" });
  const startRes = await provider.start(cfg);
  assert.equal(startRes.status, "running");
  assert.equal(startedWith.token, "secret-token");

  const st = await provider.status(cfg);
  assert.equal(st.status, "running");
  assert.equal(st.quickUrl, "https://test.trycloudflare.com");

  const stopRes = await provider.stop(cfg);
  assert.equal(stopRes.status, "stopped");
  assert.equal(stopped, true);
});

test("cloudflared provider openService returns peer gatewayApi endpoint", async () => {
  const provider = createCloudflaredProvider({
    paths: { cloudflaredPidPath: "/tmp/cf.pid", cloudflaredLogPath: "/tmp/cf.log" },
  });

  const peer = {
    id: "desktop-peer",
    services: {
      gatewayApi: "https://desktop-shrimp.trycloudflare.com",
    },
  };

  const opened = await provider.openService(peer, "gateway-api");
  assert.equal(opened.service, "gateway-api");
  assert.equal(opened.endpoint, "https://desktop-shrimp.trycloudflare.com");
});
