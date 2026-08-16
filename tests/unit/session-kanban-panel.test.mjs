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

test("panel exposes client display names and title copy action", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /"Claude desktop"/);
  assert.match(source, /"Antigravity"/);
  assert.match(source, /__sessionKanbanCopyTitle/);
  assert.match(source, /ondblclick/);
});

test("target session options are grouped by client", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /renderTargetOptions/);
  assert.match(source, /<optgroup label=/);
 assert.match(source, /visibleSessionsByClient/);
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(source, /visibleSessions\(\{ includeCompleted: false }\).filter/);
  assert.match(css, /grid-template-columns: minmax\(180px, 320px\) minmax\(300px, auto\) auto/);
});

test("card metadata is not selectable while title remains copyable", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(css, /\.session-kanban-title/);
  assert.match(css, /\.session-kanban-card small, \.session-kanban-card time \{[^}]*user-select: none/);
});

test("board renders only meaningful columns and shows searchable short ids", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /columnsToRender/);
  assert.match(source, /shortSessionId/);
  assert.match(source, /session-kanban-id/);
  assert.match(source, /搜索标题、路径或 ID/);
});

test("compose form uses the panel input typography", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(css, /\.session-kanban-compose select,\.session-kanban-compose textarea\s*\{/);
  assert.match(css, /font-family: var\(--font-sans\)/);
  assert.match(css, /font-size: 13px/);
});

test("styles define board columns without nested cards", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(css, /\.session-kanban-board/);
  assert.match(css, /\.session-kanban-card/);
});
