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
  assert.match(source, /filterBoardSessions/);
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
  assert.match(source, /targetSessionsByClient/);
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
});

test("card metadata is not selectable while title remains copyable", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(css, /\.session-kanban-title/);
  assert.match(css, /\.session-kanban-card small, \.session-kanban-card time \{[^}]*user-select: none/);
});

test("board renders only meaningful columns and shows searchable short ids", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /shortSessionId/);
  assert.match(source, /session-kanban-id/);
  assert.match(source, /搜索标题、路径或 ID/);
});

test("board filters are independent from target session picker", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /filterBoardSessions/);
  assert.match(source, /targetSessionsByClient/);
  assert.doesNotMatch(source, /visibleSessions\(\{ includeCompleted: false }\).filter/);
});

test("board toolbar keeps search and segmented controls grouped", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(css, /\.session-kanban-filter-group\s*\{/);
  assert.match(css, /\.session-kanban-segmented button\s*\{[^}]*padding: 0 18px/);
});

test("client filter labels stay on one line and refresh is right-aligned", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(css, /\.session-kanban-segmented button\s*\{[^}]*white-space: nowrap/);
  assert.match(css, /\.session-kanban-segmented button\s*\{[^}]*justify-content: center/);
  assert.match(css, /\.session-kanban-toolbar\s*\{[^}]*grid-template-columns: minmax\(0, auto\) auto/);
});

test("board explains status transitions near the toolbar", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /session-kanban-rules/);
  assert.match(source, /90 秒内有活动/);
  assert.match(source, /超过 48 小时不展示/);
  assert.match(source, /有待发消息时优先显示为「排队中」/);
});

test("session id supports double-click copy", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  assert.match(source, /__sessionKanbanCopyId/);
  assert.match(source, /session-kanban-id[^>]*ondblclick/);
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

test("panel exposes paths configuration modal and actions", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(source, /\/v1\/session-kanban\/paths/);
  assert.match(source, /__sessionKanbanOpenPaths/);
  assert.match(source, /__sessionKanbanSavePaths/);
  assert.match(source, /__sessionKanbanResetPaths/);
  assert.match(css, /\.session-kanban-modal/);
  assert.match(css, /\.path-badge\.exists/);
  assert.match(css, /\.path-badge\.missing/);
});

test("panel renders chat drawer and full conversation stream", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/session-kanban.ts"), "utf8");
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");
  assert.match(source, /\/v1\/session-kanban\/sessions\//);
  assert.match(source, /__sessionKanbanOpenChat/);
  assert.match(source, /__sessionKanbanChatDispatch/);
  assert.match(css, /\.session-kanban-drawer/);
  assert.match(css, /\.session-kanban-msg-item/);
  assert.match(css, /\.session-kanban-msg-item\.is-user/);
  assert.match(css, /\.session-kanban-msg-item\.is-assistant/);
});
