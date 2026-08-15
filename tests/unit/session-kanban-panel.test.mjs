import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("panel registers session kanban module and navigation", () => {
  const main = fs.readFileSync(path.join(root, "desktop/src/main.ts"), "utf8");
  const html = fs.readFileSync(path.join(root, "desktop/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "desktop/src/app.ts"), "utf8");
  assert.match(main, /modules\/session-kanban/);
  assert.match(html, /section-session-kanban/);
  assert.match(html, /switchTab\('session-kanban'\)/);
  assert.match(app, /'session-kanban'/);
});

test("panel module fetches board and submits queue messages", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /\/v1\/session-kanban\/board/);
  assert.match(source, /\/v1\/session-kanban\/queue/);
  assert.match(source, /\/v1\/session-kanban\/dispatch/);
  assert.match(source, /registerTab\("session-kanban"/);
});

test("panel module filters clients and limits target options", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /visibleSessions/);
  assert.match(source, /slice\(0, 30\)/);
  assert.match(source, /completed/);
  assert.match(source, /idle/);
});

test("styles define board columns without nested cards", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(css, /\.session-kanban-board/);
  assert.match(css, /\.session-kanban-card/);
});
