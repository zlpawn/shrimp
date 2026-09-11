import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createNatTraversalService,
  routeNatTraversalRequest,
  defaultNatTraversalConfig,
} from "../../lib/nat-traversal/index.mjs";
import { createProviderRegistry } from "../../lib/nat-traversal/providers/registry.mjs";
import { createNatTraversalSecretStore } from "../../lib/nat-traversal/infra/secret-store.mjs";
import { createCloudflaredSupervisor } from "../../lib/nat-traversal/process/cloudflared-supervisor.mjs";
import { HubStore } from "../../lib/session-sync/hub-store.mjs";
import {
  generateManifest,
  getSessionSafely,
  mergeSessionLWW,
} from "../../lib/session-sync/peer-protocol.mjs";

function makeReq(method, reqPath, body, headers = {}) {
  const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  return {
    method,
    url: reqPath,
    headers: { ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    on(event, handler) {
      if (event === "data" && bodyBuf.length > 0) handler(bodyBuf);
      if (event === "end") setTimeout(handler, 0);
    },
    destroy() {},
  };
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    chunks: [],
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    end(data) {
      if (data !== undefined) {
        this.body = data;
      } else if (this.chunks.length > 0) {
        this.body = this.chunks.join("");
      }
    },
    json() {
      if (typeof this.body === "string") {
        try {
          return JSON.parse(this.body);
        } catch {
          return this.body;
        }
      }
      return this.body || {};
    },
  };
}

function createTestContext() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-cf-test-"));
  const paths = {
    projectRoot: tmpDir,
    configPath: path.join(tmpDir, "nat-traversal.config.json"),
    secretsPath: path.join(tmpDir, "nat-traversal.secrets.json"),
    configDir: tmpDir,
    dataDir: tmpDir,
    generatedFrpcConfigPath: path.join(tmpDir, "frpc.toml"),
    pidPath: path.join(tmpDir, "frpc.pid"),
    logPath: path.join(tmpDir, "frpc.log"),
    cloudflaredPidPath: path.join(tmpDir, "cloudflared.pid"),
    cloudflaredLogPath: path.join(tmpDir, "cloudflared.log"),
  };

  let storedConfig = defaultNatTraversalConfig();
  const configStore = {
    get: () => storedConfig,
    save: (next) => {
      storedConfig = next;
    },
  };
  const secretStore = createNatTraversalSecretStore({ secretsPath: paths.secretsPath });

  let runningProc = null;
  const providerRegistry = createProviderRegistry({
    paths,
    logger: { log() {}, warn() {}, error() {} },
    cloudflaredSupervisorFactory: (opts) =>
      createCloudflaredSupervisor({
        ...opts,
        spawnRunner: (bin, args) => {
          if (opts.logPath) {
            fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
            fs.appendFileSync(
              opts.logPath,
              "INF |  https://shrimp-test-tunnel.trycloudflare.com  |\n",
              "utf8",
            );
          }
          runningProc = { pid: 12345 };
          return runningProc;
        },
        isProcessRunning: (pid) => Boolean(runningProc && pid === runningProc.pid),
        killProcess: (pid) => {
          if (runningProc && pid === runningProc.pid) {
            runningProc = null;
            return true;
          }
          return false;
        },
      }),
  });

  const service = createNatTraversalService({
    paths,
    configStore,
    secretStore,
    providerRegistry,
    logger: { log() {}, warn() {}, error() {} },
  });

  return { tmpDir, paths, configStore, secretStore, service };
}

test("Cloudflare Tunnel API - updates config and stores secrets isolated from gateway models", async (t) => {
  const ctx = createTestContext();
  t.after(() => fs.rmSync(ctx.tmpDir, { recursive: true, force: true }));

  // 1. Initial config via API
  const res1 = makeRes();
  await routeNatTraversalRequest(makeReq("GET", "/v1/nat-traversal/config"), res1, {}, "/v1/nat-traversal/config", {
    service: ctx.service,
  });
  assert.equal(res1.statusCode, 200);
  const cfg1 = res1.json();
  assert.equal(cfg1.cloudflared.mode, "quick");
  assert.equal(cfg1.secrets.cloudflaredTokenConfigured, false);

  // 2. Update config with token mode and token secret
  const res2 = makeRes();
  await routeNatTraversalRequest(
    makeReq("PUT", "/v1/nat-traversal/config", {
      activeProvider: "cloudflared",
      cloudflared: {
        mode: "token",
        localUrl: "http://127.0.0.1:8788",
      },
      secrets: {
        cloudflared: {
          token: "cf-secret-token-12345",
        },
      },
    }),
    res2,
    {},
    "/v1/nat-traversal/config",
    { service: ctx.service },
  );
  assert.equal(res2.statusCode, 200);
  const cfg2 = res2.json();
  assert.equal(cfg2.activeProvider, "cloudflared");
  assert.equal(cfg2.cloudflared.mode, "token");
  assert.equal(cfg2.secrets.cloudflaredTokenConfigured, true);
  // Ensure token itself is not returned in public config view
  assert.equal(cfg2.cloudflared.token, undefined);

  // 3. Verify secrets file contains the token and model secrets file was NOT created or modified
  const secretsOnDisk = JSON.parse(fs.readFileSync(ctx.paths.secretsPath, "utf8"));
  assert.equal(secretsOnDisk.cloudflared.token, "cf-secret-token-12345");
  const modelSecretsPath = path.join(ctx.tmpDir, "gateway.secrets.json");
  assert.equal(fs.existsSync(modelSecretsPath), false);
});

test("Cloudflare Tunnel API - lifecycle control starts and captures publicUrl", async (t) => {
  const ctx = createTestContext();
  t.after(() => fs.rmSync(ctx.tmpDir, { recursive: true, force: true }));

  // Set active provider to cloudflared
  await ctx.service.updateConfig({ activeProvider: "cloudflared" });

  // Start cloudflared
  const resStart = makeRes();
  await routeNatTraversalRequest(makeReq("POST", "/v1/nat-traversal/start"), resStart, {}, "/v1/nat-traversal/start", {
    service: ctx.service,
  });
  assert.equal(resStart.statusCode, 200);

  // Check status via API
  const resStatus = makeRes();
  await routeNatTraversalRequest(makeReq("GET", "/v1/nat-traversal/status"), resStatus, {}, "/v1/nat-traversal/status", {
    service: ctx.service,
  });
  assert.equal(resStatus.statusCode, 200);
  const st = resStatus.json();
  assert.equal(st.activeProvider, "cloudflared");
  assert.equal(st.provider.status, "running");
  assert.equal(st.provider.pid, 12345);
  assert.equal(st.provider.publicUrl, "https://shrimp-test-tunnel.trycloudflare.com");
  assert.equal(st.providers.cloudflared.publicUrl, "https://shrimp-test-tunnel.trycloudflare.com");

  // Stop cloudflared
  const resStop = makeRes();
  await routeNatTraversalRequest(makeReq("POST", "/v1/nat-traversal/stop"), resStop, {}, "/v1/nat-traversal/stop", {
    service: ctx.service,
  });
  assert.equal(resStop.statusCode, 200);
});

test("Session Sync API protocol - manifest, file retrieval with traversal security, and LWW merge", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-sync-api-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const hubStore = new HubStore({ baseDir: path.join(tmpDir, "hub") });

  // Save an initial session
  hubStore.saveSession({
    session_id: "test-sess-001",
    source_app: "codex",
    workspace_path: "/work/test",
    updated_at: "2026-09-11T12:00:00.000Z",
    summary: "initial session",
    messages: [{ role: "user", content: "hello" }],
  });

  // 1. Generate manifest
  const manifest = generateManifest(hubStore);
  assert.equal(manifest.sessions.length, 1);
  assert.equal(manifest.sessions[0].session_id, "test-sess-001");
  assert.equal(manifest.sessions[0].summary, "initial session");

  // 2. Safe retrieval
  const safeSession = getSessionSafely(hubStore, "test-sess-001");
  assert.equal(safeSession.session_id, "test-sess-001");

  // 3. Security: traversal rejection
  assert.throws(
    () => getSessionSafely(hubStore, "../../../etc/passwd"),
    /invalid_session_id/
  );

  // 4. LWW Merge - older incoming session is rejected/kept local
  const olderResult = mergeSessionLWW(hubStore, {
    session_id: "test-sess-001",
    updated_at: "2026-09-10T12:00:00.000Z",
    summary: "older session",
  });
  assert.equal(olderResult.updated, false);
  assert.equal(olderResult.action, "kept_local");
  assert.equal(hubStore.getSession("test-sess-001").summary, "initial session");

  // 5. LWW Merge - newer incoming session overwrites local
  const newerResult = mergeSessionLWW(hubStore, {
    session_id: "test-sess-001",
    updated_at: "2026-09-11T15:00:00.000Z",
    summary: "newer session",
  });
  assert.equal(newerResult.updated, true);
  assert.equal(newerResult.action, "overwritten");
  assert.equal(hubStore.getSession("test-sess-001").summary, "newer session");
});
