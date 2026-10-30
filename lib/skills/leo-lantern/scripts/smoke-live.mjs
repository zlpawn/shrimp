#!/usr/bin/env node
/**
 * Leo Lantern Live Smoke Test
 *
 * Runs the standard smoke test against a running Leo Lantern instance:
 * 1. Verifies bridge doctor (checks extension version is present).
 * 2. Runs state command, asserts elements.length > 0 and refs allocated.
 * 3. Runs find command with specified text (if provided).
 * 4. Runs click command with specified text (if --click flag enabled).
 *
 * Usage:
 *   node lib/skills/leo-lantern/scripts/smoke-live.mjs [--port 19527] [--text "按钮文本"] [--click]
 */

import { executeCommand } from "./cli/lib/cli.mjs";

function parseArgs(args) {
  const parsed = { port: 19527, text: null, click: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) parsed.port = Number(args[++i]);
    else if (arg === "--text" && args[i + 1]) parsed.text = args[++i];
    else if (arg === "--click") parsed.click = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
  }
  return parsed;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node lib/skills/leo-lantern/scripts/smoke-live.mjs [--port 19527] [--text '按钮文本'] [--click]");
    process.exit(0);
  }

  const endpoint = `http://127.0.0.1:${options.port}`;
  console.log(`[Smoke] 1. Checking Lantern Doctor on ${endpoint}...`);
  const doctor = await executeCommand(endpoint, "doctor", []);
  if (!doctor.ok) {
    console.error("❌ Doctor check failed:", doctor);
    process.exit(1);
  }
  const version = doctor.result?.extension?.version || doctor.result?.extension?.info?.version;
  console.log(`✅ Bridge reachable, extension version: ${version || "unknown"}`);

  console.log(`[Smoke] 2. Checking state on active page...`);
  const state = await executeCommand(endpoint, "state", []);
  if (!state.ok) {
    console.error("❌ State check failed:", state);
    process.exit(1);
  }
  const elements = state.result?.elements || [];
  const gen = state.result?.generation;
  console.log(`✅ State succeeded: URL=${state.result?.url}, generation=${gen}, elements=${elements.length}`);
  if (elements.length === 0) {
    console.error("❌ REGRESSION: elements is empty! isVisible may have failed.");
    process.exit(1);
  }
  const firstWithRef = elements.find((el) => el.ref);
  if (!firstWithRef) {
    console.error("❌ REGRESSION: no elements have a ref assigned!");
    process.exit(1);
  }
  console.log(`✅ State elements verified. First element: <${firstWithRef.tag}> ref=${firstWithRef.ref} text="${firstWithRef.text?.slice(0, 30)}"`);

  if (options.text) {
    console.log(`[Smoke] 3. Checking find --text "${options.text}"...`);
    const find = await executeCommand(endpoint, "find", ["--target", JSON.stringify({ kind: "semantic", text: options.text, match: "contains" })]);
    if (!find.ok) {
      console.error("❌ Find failed:", find);
      process.exit(1);
    }
    const matchesN = find.result?.matches_n ?? find.result?.elements?.length ?? 0;
    console.log(`✅ Find succeeded: matches_n=${matchesN}`);
    if (matchesN === 0) {
      console.warn(`⚠️ Warning: No elements matched text "${options.text}" on current page`);
    }

    if (options.click) {
      console.log(`[Smoke] 4. Clicking element with text "${options.text}"...`);
      const click = await executeCommand(endpoint, "click", ["--text", options.text]);
      console.log("Click result:", JSON.stringify(click, null, 2));
      if (!click.ok || click.result?.clicked === false) {
        console.error("❌ Click failed!");
        process.exit(1);
      }
      console.log("✅ Click dispatched successfully!");
    }
  }

  console.log("\n🎉 All smoke checks passed!");
}

run().catch((err) => {
  console.error("❌ Smoke test error:", err);
  process.exit(1);
});
