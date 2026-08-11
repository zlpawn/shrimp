// Dream Skin entry point: launch Codex with debug port, connect CDP,
// inject skin. CLI usage: node lib/dream-skin/index.mjs [--theme <path>]

import { launchCodexWithDebugPort, DEFAULT_DEBUG_PORT } from "./launcher.mjs";
import { pickPrimaryTarget, CdpSession } from "./cdp-client.mjs";
import { loadTheme, buildInjectionScript, buildCleanupScript } from "./injector.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THEME_PATH = path.join(__dirname, "themes", "default.json");

function parseArgs(argv) {
  const args = { themePath: DEFAULT_THEME_PATH, appPath: "", debugPort: DEFAULT_DEBUG_PORT };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--theme" && argv[i + 1]) {
      args.themePath = argv[++i];
    } else if (arg === "--app" && argv[i + 1]) {
      args.appPath = argv[++i];
    } else if (arg === "--port" && argv[i + 1]) {
      args.debugPort = Number(argv[++i]);
    } else if (arg === "--cleanup" || arg === "--remove") {
      args.cleanup = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node lib/dream-skin/index.mjs [options]

Options:
  --theme <path>   Theme JSON file (default: themes/default.json)
  --app <path>     Codex desktop app path (default: auto-detect)
  --port <port>    CDP debug port (default: ${DEFAULT_DEBUG_PORT})
  --cleanup        Remove injected skin from running Codex
  --help           Show this help
`);
}

async function injectSkin({ themePath, appPath, debugPort }) {
  console.log(`[dream-skin] loading theme: ${themePath}`);
  const { theme, backgroundDataUri } = loadTheme(themePath);
  console.log(`[dream-skin] theme: ${theme.name || theme.id}`);
  if (backgroundDataUri) {
    console.log(
      `[dream-skin] background image loaded (${Math.round(backgroundDataUri.length / 1024)}KB data URI)`,
    );
  }

  console.log(`[dream-skin] launching Codex with debug port ${debugPort}...`);
  const launch = await launchCodexWithDebugPort({ appPath, debugPort });
  console.log(`[dream-skin] Codex launched: ${launch.appPath}`);

  console.log(`[dream-skin] connecting to CDP...`);
  const target = await pickPrimaryTarget(debugPort);
  console.log(`[dream-skin] target: ${target.title} (${target.url})`);

  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.connect();
  console.log(`[dream-skin] CDP session connected`);

  const script = buildInjectionScript({ theme, backgroundDataUri });

  // Register the script to run on every new document (survives navigation/refresh).
  // CodexPlusPlus uses the same two-step pattern: addScriptToEvaluateOnNewDocument
  // for persistence + Runtime.evaluate for immediate effect (bridge.rs:210-225).
  await session.addScriptToNewDocuments(script);
  console.log(`[dream-skin] script registered for new documents`);

  const result = await session.evaluate(script);
  const ok = result?.result?.value === true;
  console.log(`[dream-skin] injection ${ok ? "succeeded" : "may have failed"}`);

  console.log(
    `[dream-skin] skin is live. Press Ctrl+C to detach (Codex keeps running).`,
  );

  // Guard against double-cleanup (SIGINT can fire multiple times).
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await session.evaluate(buildCleanupScript());
      console.log(`[dream-skin] cleanup done`);
    } catch {
      // session may already be closed
    }
    await session.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // If the Codex app exits, we exit too.
  launch.child.on("exit", () => {
    console.log(`[dream-skin] Codex app exited`);
    process.exit(0);
  });
}

async function cleanupRunning({ debugPort }) {
  console.log(`[dream-skin] connecting to CDP on port ${debugPort}...`);
  const target = await pickPrimaryTarget(debugPort);
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.connect();
  await session.evaluate(buildCleanupScript());
  console.log(`[dream-skin] skin removed`);
  await session.close();
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.cleanup) {
    await cleanupRunning({ debugPort: args.debugPort });
    return;
  }
  await injectSkin(args);
}

main().catch((error) => {
  console.error(`[dream-skin] error: ${error.message}`);
  process.exit(1);
});
