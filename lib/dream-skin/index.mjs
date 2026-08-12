/**
 * Dream Skin offline CLI: validate themes, validate engines, build scripts.
 * NEVER starts Codex, connects CDP, or injects. Only imports offline
 * builders — no process/CDP modules.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { loadRuntimeTheme, buildInjectionScript } from "./runtime/injector.mjs";
import { validateEngineAssets, assertScriptParses } from "./runtime/engine-assets.mjs";

const COMMANDS = new Set(["validate", "validate-engines", "build-script", "help", "--help", "-h"]);
const FORBIDDEN = new Set(["inject", "launch", "cleanup", "remove", "--app", "--port"]);

export function parseArgs(argv) {
  const args = { command: "", theme: "", image: "", output: "", help: false, errors: [] };
  const tokens = argv.slice(2);

  if (tokens.length === 0) {
    args.help = true;
    return args;
  }

  const first = tokens[0];
  if (first === "--help" || first === "-h" || first === "help") {
    args.help = true;
    return args;
  }

  if (!COMMANDS.has(first) || FORBIDDEN.has(first)) {
    args.errors.push(`unknown command: ${first}`);
    return args;
  }
  args.command = first;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (FORBIDDEN.has(token)) {
      args.errors.push(`option not allowed in offline mode: ${token}`);
      continue;
    }
    if (token === "--theme" && tokens[i + 1]) {
      args.theme = tokens[++i];
    } else if (token === "--image" && tokens[i + 1]) {
      args.image = tokens[++i];
    } else if (token === "--output" && tokens[i + 1]) {
      args.output = tokens[++i];
    } else if (token.startsWith("--") || token.startsWith("-")) {
      args.errors.push(`unknown option: ${token}`);
    } else {
      args.errors.push(`unexpected argument: ${token}`);
    }
  }

  if (args.command === "build-script" && !args.output) {
    args.errors.push("build-script requires --output <script.js>");
  }
  if ((args.command === "validate" || args.command === "build-script") && !args.theme) {
    args.errors.push("this command requires --theme <theme.json>");
  }

  return args;
}

export async function runCli(args, deps = {}) {
  const readFile = deps.readFile || ((p) => fs.readFile(p));
  const writeFile = deps.writeFile || ((p, data, opts) => fs.writeFile(p, data, opts));

  if (args.help) {
    console.log(`Usage: node lib/dream-skin/index.mjs <command> [options]

Commands:
  validate --theme <theme.json> [--image <background.ext>]
      Validate a theme (and optional image) without writing anything.

  validate-engines
      Verify all four engine assets load and report stable signatures.

  build-script --theme <theme.json> --image <background.ext> --output <script.js>
      Build an offline injection script. The script is written to disk,
      never evaluated, and never applied to Codex.

Offline only: this CLI never launches, connects to, or modifies Codex.
`);
    return 0;
  }

  if (args.errors.length > 0) {
    for (const error of args.errors) {
      console.error(`error: ${error}`);
    }
    console.error("Run `node lib/dream-skin/index.mjs --help` for usage.");
    return 2;
  }

  try {
    if (args.command === "validate") {
      const themeBytes = await readFile(args.theme);
      let imageBytes = null;
      if (args.image) {
        imageBytes = await readFile(args.image);
      }
      const { theme, imageFormat } = loadRuntimeTheme({ themeJsonBytes: themeBytes, imageBytes });
      console.log(`[dream-skin] theme valid: ${theme.id} (${theme.name})`);
      if (imageFormat) {
        console.log(`[dream-skin] image valid: ${imageFormat.mime} (${imageFormat.size} bytes)`);
      } else {
        console.log("[dream-skin] no image provided (builtin default)");
      }
      return 0;
    }

    if (args.command === "validate-engines") {
      const results = validateEngineAssets();
      for (const r of results) {
        console.log(`[dream-skin] engine ${r.engine}: script=${r.scriptSignature} css=${r.cssSignature}`);
      }
      return 0;
    }

    if (args.command === "build-script") {
      const themeBytes = await readFile(args.theme);
      const imageBytes = await readFile(args.image);
      const { theme, backgroundDataUri } = loadRuntimeTheme({ themeJsonBytes: themeBytes, imageBytes });
      const script = buildInjectionScript({ theme, backgroundDataUri });
      assertScriptParses(script);

      // Never write over the theme or image inputs
      const resolvedOutput = path.resolve(args.output);
      const resolvedTheme = path.resolve(args.theme);
      const resolvedImage = path.resolve(args.image);
      if (resolvedOutput === resolvedTheme || resolvedOutput === resolvedImage) {
        throw new Error("output path must not be the same as the theme or image input");
      }

      await writeFile(resolvedOutput, script, { mode: 0o600 });
      console.log(`[dream-skin] script written: ${resolvedOutput}`);
      return 0;
    }
  } catch (error) {
    console.error(`[dream-skin] error: ${error.message || error}`);
    return 1;
  }

  return 2;
}

async function main() {
  const args = parseArgs(process.argv);
  const code = await runCli(args);
  process.exitCode = code;
}

main();