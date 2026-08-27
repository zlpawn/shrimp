import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  routeOfficialRemoteLinkRequest,
  createOfficialRemoteLinkService,
  createOfficialRemoteLinkSqliteStore,
} from "../../lib/remote-session/official-links/index.mjs";

const VALID_URL = "https://antigravity.google.com/r/demo-v2?p=c%2Fdemo%3Fsection%3Ddemo";
const panelRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "official-links-"));
  return createOfficialRemoteLinkSqliteStore({ dbPath: path.join(dir, "gateway.db") });
}

function makeRequest(method, path, body) {
  const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  return {
    method,
    url: path,
    headers: {},
    on(event, handler) {
      if (event === "data" && raw.length) handler(raw);
      if (event === "end") setTimeout(handler, 0);
    },
    destroy() {},
  };
}

function makeResponse() {
  return {
    headers: null,
    chunks: [],
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    end(chunk) {
      if (chunk !== undefined) this.body = String(chunk);
    },
  };
}

test("official link store persists CRUD records in sqlite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "official-links-reopen-"));
  const dbPath = path.join(dir, "gateway.db");
  const store = createOfficialRemoteLinkSqliteStore({ dbPath });
  const created = store.create({ name: "工作台", url: VALID_URL });

  assert.equal(created.name, "工作台");
  assert.equal(created.url, VALID_URL);
  assert.equal(created.kind, "antigravity");
  assert.ok(created.id);

  const updated = store.update(created.id, { name: "Mac 工作台" });
  assert.equal(updated.name, "Mac 工作台");
  assert.equal(updated.url, VALID_URL);

  store.close();
  const reopened = createOfficialRemoteLinkSqliteStore({ dbPath });
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].name, "Mac 工作台");
  assert.equal(reopened.delete(created.id).id, created.id);
  assert.deepEqual(reopened.list(), []);
  reopened.close();
});

test("service validates names and official antigravity https links", async () => {
  const service = createOfficialRemoteLinkService({ store: makeStore() });

  await assert.rejects(
    () => service.create({ name: "  ", url: VALID_URL }),
    /link name is required/i,
  );
  await assert.rejects(
    () => service.create({ name: "bad", url: "http://antigravity.google.com/r/demo" }),
    /https/i,
  );
  await assert.rejects(
    () => service.create({ name: "bad", url: "https://example.com/r/demo" }),
    /antigravity.google.com/i,
  );
  await assert.rejects(
    () => service.create({ name: "bad", url: "https://evil.com/https://antigravity.google.com/r/demo" }),
    /antigravity.google.com/i,
  );
});

test("service checks frame policy without exposing the full private link", async () => {
  const requests = [];
  const service = createOfficialRemoteLinkService({
    store: makeStore(),
    fetchImpl: async (_url, init) => {
      requests.push(init);
      return {
        status: 200,
        headers: new Map([
          ["x-frame-options", "SAMEORIGIN"],
          ["content-security-policy", "frame-ancestors 'self'"],
        ]),
      };
    },
  });
  const created = await service.create({ name: "工作台", url: VALID_URL });
  const checked = await service.checkFramePolicy(created.id);

  assert.equal(checked.embeddable, false);
  assert.equal(checked.reason, "x_frame_options_sameorigin");
  assert.equal(checked.xFrameOptions, "SAMEORIGIN");
  assert.equal(checked.url, VALID_URL);
  assert.equal(requests.length, 1);
});

test("HTTP official link routes expose CRUD and frame policy checks", async () => {
  const service = createOfficialRemoteLinkService({
    store: makeStore(),
    fetchImpl: async () => ({
      status: 200,
      headers: new Map([["x-frame-options", "SAMEORIGIN"]]),
    }),
  });
  async function call(method, path, body) {
    const res = makeResponse();
    await routeOfficialRemoteLinkRequest(makeRequest(method, path, body), res, {}, path, { service });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { res, json: res.body ? JSON.parse(res.body) : null };
  }

  const created = await call("POST", "/v1/remote-session/official-links", {
    name: "工作台",
    url: VALID_URL,
  });
  assert.equal(created.res.statusCode, 200);
  assert.equal(created.json.link.name, "工作台");

  const listed = await call("GET", "/v1/remote-session/official-links");
  assert.equal(listed.json.links.length, 1);

  const checked = await call("GET", "/v1/remote-session/official-links/" + encodeURIComponent(created.json.link.id) + "/frame-policy");
  assert.equal(checked.json.embeddable, false);
  assert.equal(checked.json.reason, "x_frame_options_sameorigin");

  const bad = await call("POST", "/v1/remote-session/official-links", {
    name: "bad",
    url: "https://example.com",
  });
  assert.equal(bad.res.statusCode, 400);
  assert.equal(bad.json.error.type, "invalid_request");
});

test("remote session panel exposes official link manager and wheel selector", () => {
  const source = fs.readFileSync(path.join(panelRoot, "desktop/src/modules/remote-session.ts"), "utf8");
  const css = fs.readFileSync(path.join(panelRoot, "desktop/src/styles/panel.css"), "utf8");
  assert.match(source, /Antigravity 官方远程控制/);
  assert.match(source, /official-links/);
  assert.match(source, /__rsOpenOfficialLink/);
  assert.match(source, /noopener,noreferrer/);
  assert.match(source, /rs-official-link-track/);
  assert.match(css, /.rs-official-link-track\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /.rs-official-link-pill\.active/);
});

test("remote session panels and dialogs use spacious grouped layouts", () => {
  const source = fs.readFileSync(path.join(panelRoot, "desktop/src/modules/remote-session.ts"), "utf8");
  const css = fs.readFileSync(path.join(panelRoot, "desktop/src/styles/panel.css"), "utf8");

  assert.match(source, /class="rs-modal-card rs-modal-shell rs-modal-wide"[^>]*onclick="event\.stopPropagation\(\)"[\s\S]*?rs-official-name/);
  assert.match(source, /class="rs-modal-card rs-modal-shell rs-modal-wide"[\s\S]*?modal-peer-transport-type/);
  assert.match(source, /class="rs-modal-header"[\s\S]*?class="rs-modal-body"[\s\S]*?class="rs-modal-footer"/);
  assert.match(css, /.rs-modal-wide\s*\{[^}]*max-width:\s*720px/s);
  assert.match(css, /.rs-modal-body\s*\{[^}]*overflow-y:\s*auto/s);

  const catalogStart = source.indexOf("function renderCatalog");
  const catalogEnd = source.indexOf("function renderAntigravityScene", catalogStart);
  const catalog = source.slice(catalogStart, catalogEnd);
  assert.equal((catalog.match(/class="endpoints-grid"/g) || []).length, 1);
  assert.match(catalog, /Antigravity 远程编码[\s\S]*Antigravity 官方远程控制/);
});
