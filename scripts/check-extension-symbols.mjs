import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const noop = () => {};
const listener = { addListener: noop, removeListener: noop };

globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => ({ addEventListener: noop, value: "", textContent: "" }),
  addEventListener: noop,
  removeEventListener: noop,
};
globalThis.chrome = {
  runtime: { onInstalled: listener, onStartup: listener, onMessage: listener, onMessageExternal: listener, id: "check-test", getURL: (p) => p, getManifest: () => ({ version: "1.3.1" }) },
  alarms: { create: noop, get: async () => {}, clear: noop, onAlarm: listener },
  cookies: { getAll: noop },
  storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
  debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async () => {}, onEvent: listener, onDetach: listener },
  tabs: { query: async () => [], onRemoved: listener, onUpdated: listener, get: async () => ({ id: 1 }) },
  windows: { getAll: async () => [] },
  tabGroups: { update: async () => {} },
  action: { onClicked: listener },
};

const extDir = resolve("extensions/leo-cookie-txt-locally");
const files = readdirSync(extDir).filter((file) => file.endsWith(".mjs") || file.endsWith(".js"));

let hasError = false;
for (const file of files) {
  try {
    await import(resolve(extDir, file));
  } catch (err) {
    console.error(`Check failed for ${file}:`, err);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log(`Verified ${files.length} extension scripts: all symbols and imports resolved.`);
  process.exit(0);
}
