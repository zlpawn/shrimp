import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  PROJECT_ROOT,
  resolveProjectPath,
} from "../../lib/config/project-paths.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";

// Normalize path separators for cross-platform test assertions.
const P = (p) => p.replace(/\//g, path.sep);

test("resolveProjectPath keeps absolute paths and resolves relative paths under the project", () => {
  assert.equal(resolveProjectPath("gateway.config.json"), path.join(PROJECT_ROOT, "gateway.config.json"));
  assert.equal(resolveProjectPath("/tmp/shrimp/gateway.config.json"), "/tmp/shrimp/gateway.config.json");
  assert.equal(resolveProjectPath(""), "");
});

test("dream-skin data follows the resolved gateway config directory", () => {
  const paths = resolveDreamSkinPaths({
    configFile: "config/gateway.config.json",
    projectRoot: "/workspace/shrimp",
  });

  assert.deepEqual(paths, {
    configPath: P("/workspace/shrimp/config/gateway.config.json"),
    configDir: P("/workspace/shrimp/config"),
    rootDir: P("/workspace/shrimp/config/dream-skin"),
    themesDir: P("/workspace/shrimp/config/dream-skin/themes"),
    marketDir: P("/workspace/shrimp/config/dream-skin/market"),
    previewsDir: P("/workspace/shrimp/config/dream-skin/market/previews"),
    stagingDir: P("/workspace/shrimp/config/dream-skin/.staging"),
    statePath: P("/workspace/shrimp/config/dream-skin/state.json"),
    marketIndexPath: P("/workspace/shrimp/config/dream-skin/market/index.json"),
    installedPath: P("/workspace/shrimp/config/dream-skin/market/installed.json"),
  });
});

test("an npm data-dir config keeps dream-skin data beside that config", () => {
  const paths = resolveDreamSkinPaths({
    configFile: "/Users/example/.shrimp/gateway.config.json",
    projectRoot: "/unused/project",
  });

  assert.equal(paths.rootDir, P("/Users/example/.shrimp/dream-skin"));
  assert.equal(paths.themesDir, P("/Users/example/.shrimp/dream-skin/themes"));
});